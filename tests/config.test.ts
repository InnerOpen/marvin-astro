import { describe, expect, it } from 'vitest';
import { DEFAULT_DEV_RETRY_MS, describeConfig, readEnv, resolveConfig } from '../src/config.js';

describe('readEnv', () => {
  it('prefers the override map and treats blank/missing as absent', () => {
    expect(readEnv('MARVIN_API_URL', { MARVIN_API_URL: 'http://override' })).toBe('http://override');
    expect(readEnv('MARVIN_API_URL', { MARVIN_API_URL: '   ' })).toBeUndefined();
    expect(readEnv('DEFINITELY_MISSING_KEY_XYZ', {})).toBeUndefined();
  });
});

describe('resolveConfig', () => {
  it('lets an explicit option win over env', () => {
    const cfg = resolveConfig({ apiUrl: 'explicit', env: { MARVIN_API_URL: 'from-env' } });
    expect(cfg.apiUrl).toBe('explicit');
  });

  it('reads all three connection values from the env seam and marks configured', () => {
    const cfg = resolveConfig({
      env: { MARVIN_API_URL: 'http://x', MARVIN_SITE_CLIENT_TOKEN: 'tok', MARVIN_WORKSPACE_SLUG: 'ws' },
    });
    expect(cfg.apiUrl).toBe('http://x');
    expect(cfg.workspaceSlug).toBe('ws');
    expect(cfg.configured).toBe(true);
  });

  it('is not configured when any connection value is empty', () => {
    // An explicit empty string forces the value empty regardless of ambient env.
    expect(resolveConfig({ apiUrl: 'a', siteClientToken: 'b', workspaceSlug: '', env: {} }).configured).toBe(false);
  });

  it('resolves the debug flag from the env seam ("true" only)', () => {
    expect(resolveConfig({ env: { MARVIN_DEBUG: 'true' } }).debug).toBe(true);
    expect(resolveConfig({ env: { MARVIN_DEBUG: 'false' } }).debug).toBe(false);
    expect(resolveConfig({ debug: true }).debug).toBe(true);
  });

  it('honours an explicit retryAfterMs and defaults to the dev latch otherwise', () => {
    expect(resolveConfig({ retryAfterMs: 5 }).retryAfterMs).toBe(5);
    expect(resolveConfig({ env: {} }).retryAfterMs).toBe(DEFAULT_DEV_RETRY_MS);
  });
});

describe('describeConfig', () => {
  it('masks the token and reports presence', () => {
    const desc = describeConfig(
      resolveConfig({ apiUrl: 'http://x', siteClientToken: 'site_client_abcdefghij', workspaceSlug: 'ws' })
    );
    expect(desc.MARVIN_API_URL).toBe('http://x');
    expect(desc.MARVIN_WORKSPACE_SLUG).toBe('ws');
    expect(desc.MARVIN_SITE_CLIENT_TOKEN).toBe(`site_client_${'*'.repeat(20)}`);
    expect(desc.hasAll).toBe(true);
  });

  it('marks missing values and hasAll=false', () => {
    const desc = describeConfig(resolveConfig({ apiUrl: '', siteClientToken: '', workspaceSlug: '', env: {} }));
    expect(desc.MARVIN_API_URL).toBe('MISSING');
    expect(desc.MARVIN_SITE_CLIENT_TOKEN).toBe('MISSING');
    expect(desc.hasAll).toBe(false);
  });
});
