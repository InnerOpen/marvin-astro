/**
 * Configuration + environment resolution.
 *
 * Precedence for every value: explicit option → `import.meta.env` → `process.env`.
 * Astro exposes server-side env through `import.meta.env`; a plain Node script
 * (a smoke test, a build hook) only has `process.env`. Both work, unchanged.
 */

import type { MarkdownOptions } from './markdown.js';

export type MarvinLogger = {
  log: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
};

export const ENV_KEYS = {
  apiUrl: 'MARVIN_API_URL',
  siteClientToken: 'MARVIN_SITE_CLIENT_TOKEN',
  workspaceSlug: 'MARVIN_WORKSPACE_SLUG',
  debug: 'MARVIN_DEBUG',
} as const;

/** Dev default for the network-failure latch: retry a downed backend after 30s. */
export const DEFAULT_DEV_RETRY_MS = 30_000;

export type MarvinAstroConfig = {
  apiUrl?: string;
  siteClientToken?: string;
  workspaceSlug?: string;
  /** Log the resolved env once at startup, and enable SDK request logging. */
  debug?: boolean;
  /**
   * How long the network-failure latch stays closed before the backend is retried.
   * Defaults to 30s in dev and `Infinity` in production — a build should fail fast and
   * consistently rather than half-succeed with some pages live and some pages static.
   */
  retryAfterMs?: number;
  logger?: MarvinLogger;
  /** Markdown rendering options; defaults to `{ gfm: true, breaks: false }`. */
  markdown?: MarkdownOptions;
  /** Explicit env source. Highest priority after direct options — mainly a test seam. */
  env?: Record<string, string | undefined>;
  /** Injectable clock, so latch expiry is testable without waiting. */
  now?: () => number;
  /** Injectable SDK client factory — a test seam; defaults to the SDK's `createMarvinClient`. */
  createClient?: (config: MarvinClientOptions) => unknown;
};

export type MarvinClientOptions = {
  apiUrl: string;
  siteClientToken: string;
  workspaceSlug: string;
  debug: boolean;
};

export type ResolvedConfig = {
  apiUrl: string;
  siteClientToken: string;
  workspaceSlug: string;
  debug: boolean;
  retryAfterMs: number;
  logger: MarvinLogger;
  markdown?: MarkdownOptions;
  now: () => number;
  createClient?: (config: MarvinClientOptions) => unknown;
  /** True when all three connection values are present. */
  configured: boolean;
};

function metaEnv(): Record<string, unknown> | undefined {
  try {
    return (import.meta as unknown as { env?: Record<string, unknown> }).env;
  } catch {
    return undefined;
  }
}

function processEnv(): Record<string, string | undefined> | undefined {
  try {
    return typeof process !== 'undefined' ? process.env : undefined;
  } catch {
    return undefined;
  }
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Read one env var, honouring the documented precedence. */
export function readEnv(
  key: string,
  override?: Record<string, string | undefined>
): string | undefined {
  return nonEmpty(override?.[key]) ?? nonEmpty(metaEnv()?.[key]) ?? nonEmpty(processEnv()?.[key]);
}

function isProduction(override?: Record<string, string | undefined>): boolean {
  const prodFlag = metaEnv()?.PROD;
  if (typeof prodFlag === 'boolean') return prodFlag;
  const mode = readEnv('NODE_ENV', override) ?? readEnv('MODE', override);
  return mode === 'production';
}

export function resolveConfig(options: MarvinAstroConfig = {}): ResolvedConfig {
  const env = options.env;
  const apiUrl = options.apiUrl ?? readEnv(ENV_KEYS.apiUrl, env) ?? '';
  const siteClientToken = options.siteClientToken ?? readEnv(ENV_KEYS.siteClientToken, env) ?? '';
  const workspaceSlug = options.workspaceSlug ?? readEnv(ENV_KEYS.workspaceSlug, env) ?? '';
  const debug = options.debug ?? readEnv(ENV_KEYS.debug, env) === 'true';

  return {
    apiUrl,
    siteClientToken,
    workspaceSlug,
    debug,
    retryAfterMs:
      options.retryAfterMs ??
      (isProduction(env) ? Number.POSITIVE_INFINITY : DEFAULT_DEV_RETRY_MS),
    logger: options.logger ?? console,
    markdown: options.markdown,
    now: options.now ?? (() => Date.now()),
    createClient: options.createClient,
    configured: Boolean(apiUrl && siteClientToken && workspaceSlug),
  };
}

/** One-line summary of the resolved env, with the token masked. For `debug` logging. */
export function describeConfig(config: ResolvedConfig): Record<string, unknown> {
  const token = config.siteClientToken;
  return {
    [ENV_KEYS.apiUrl]: config.apiUrl || 'MISSING',
    [ENV_KEYS.siteClientToken]: token ? `${token.slice(0, 12)}${'*'.repeat(20)}` : 'MISSING',
    [ENV_KEYS.workspaceSlug]: config.workspaceSlug || 'MISSING',
    hasAll: config.configured,
  };
}
