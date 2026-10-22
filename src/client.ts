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

/**
 * True for a rejected site token: expired, revoked or without the permission (401/403, or the SDK's MarvinAuthError).
 * For a build that is the same as Marvin being down — it can't read the content — so `requireBackend` fails on it
 * too. Without `requireBackend` it stays an ordinary error, as before.
 */
export function isAuthFailure(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const { name, statusCode, status } = error as { name?: unknown; statusCode?: unknown; status?: unknown };
    if (name === 'MarvinAuthError') return true;
    if (statusCode === 401 || statusCode === 403 || status === 401 || status === 403) return true;
  }
  const message = errorMessage(error).toLowerCase();
  return /\b(401|403)\b/.test(message) || message.includes('unauthorized') || message.includes('forbidden');
}

/** Thrown with `requireBackend` instead of falling back: the build fails and the last good deployment stays live. */
export class MarvinUnavailableError extends Error {
  constructor(reason: string) {
    super(`[marvin-astro] ${reason}; requireBackend is on, so this build fails rather than publish the static fallbacks.`);
    this.name = 'MarvinUnavailableError';
  }
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
    if (!config.configured) {
      if (config.requireBackend) throw new MarvinUnavailableError('Marvin is not configured (MARVIN_API_URL, MARVIN_SITE_CLIENT_TOKEN, MARVIN_WORKSPACE_SLUG)');
      return false;
    }
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
      if (config.requireBackend && isAuthFailure(error)) {
        throw new MarvinUnavailableError(`Marvin rejected the site token: expired, revoked or missing a permission (${errorMessage(error)})`);
      }
      if (!isNetworkFailure(error)) return;
      if (config.requireBackend) throw new MarvinUnavailableError(`Marvin is unreachable (${errorMessage(error)})`);
      latchedAt = config.now();
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
