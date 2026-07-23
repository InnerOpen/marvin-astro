/**
 * SDK client construction and the network-failure latch.
 *
 * The latch exists because a static build asks for content once per path. When the backend is
 * down, that is N failed requests with N timeouts before the build gives up. The latch trips on
 * the first network failure and short-circuits the rest.
 *
 * Unlike the hand-rolled original it is *retryable*: it expires after `retryAfterMs` so a dev
 * server recovers on its own when the backend comes back, instead of serving stale static data
 * until someone restarts it. Production keeps the permanent latch — a build should fail fast and
 * consistently rather than half-succeed.
 */

import { createMarvinClient } from '@inneropen/marvin-sdk';
import type { MarvinClient } from '@inneropen/marvin-sdk';
import {
  describeConfig,
  resolveConfig,
  type MarvinAstroConfig,
  type ResolvedConfig,
} from './config.js';

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * A network failure means "the backend is unreachable", not "this request was bad". Only the
 * former should trip the latch — a 404 on one entry says nothing about the next one.
 */
export function isNetworkFailure(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('network error') ||
    message.includes('fetch failed') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('etimedout')
  );
}

export type MarvinBackend = {
  readonly config: ResolvedConfig;
  /** True when Marvin is configured AND not currently latched out. */
  hasBackend(): boolean;
  /** The SDK client. Throws when Marvin is not configured. */
  client(): MarvinClient;
  /** Trip the latch if this error indicates the backend is unreachable. */
  remember(error: unknown): void;
  /** True while the latch is closed (backend considered unreachable). */
  isLatched(): boolean;
  /** Manually re-open the latch, e.g. after a deploy. */
  clearLatch(): void;
  warn(message: string): void;
};

export function createBackend(options: MarvinAstroConfig = {}): MarvinBackend {
  const config = resolveConfig(options);
  let client: MarvinClient | null = null;
  let latchedAt: number | null = null;
  let envLogged = false;

  function isLatched(): boolean {
    if (latchedAt === null) return false;
    if (config.retryAfterMs === Number.POSITIVE_INFINITY) return true;
    if (config.now() - latchedAt < config.retryAfterMs) return true;

    // Expired — re-open and let the next call find out whether the backend is back.
    latchedAt = null;
    return false;
  }

  function hasBackend(): boolean {
    if (config.debug && !envLogged) {
      envLogged = true;
      config.logger.log('[marvin-astro] env check:', describeConfig(config));
    }
    if (!config.configured) return false;
    return !isLatched();
  }

  return {
    config,
    hasBackend,
    isLatched,
    clearLatch() {
      latchedAt = null;
    },
    remember(error: unknown) {
      if (isNetworkFailure(error)) latchedAt = config.now();
    },
    warn(message: string) {
      config.logger.warn(`[marvin-astro] ${message}`);
    },
    client(): MarvinClient {
      if (!config.configured) {
        throw new Error(
          '[marvin-astro] Marvin is not configured. Set MARVIN_API_URL, ' +
            'MARVIN_SITE_CLIENT_TOKEN and MARVIN_WORKSPACE_SLUG, or pass them to createMarvinContent().'
        );
      }
      client ??= (config.createClient
        ? config.createClient({
            apiUrl: config.apiUrl,
            siteClientToken: config.siteClientToken,
            workspaceSlug: config.workspaceSlug,
            debug: config.debug,
          })
        : createMarvinClient({
            apiUrl: config.apiUrl,
            siteClientToken: config.siteClientToken,
            workspaceSlug: config.workspaceSlug,
            debug: config.debug,
          })) as MarvinClient;
      return client;
    },
  };
}
