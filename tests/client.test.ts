import { describe, expect, it } from 'vitest';
import { createBackend, isNetworkFailure, MarvinUnavailableError } from '../src/client.js';
import { createFetcher } from '../src/fetch.js';
import { createFakeClient, networkError, quietLogger } from './support/fakeClient.js';

const CONNECTION = {
  apiUrl: 'http://marvin.test',
  siteClientToken: 'site_client_test',
  workspaceSlug: 'test-workspace',
  logger: quietLogger,
};

describe('isNetworkFailure', () => {
  it('recognizes transport failures', () => {
    expect(isNetworkFailure(new Error('Network error: fetch failed'))).toBe(true);
    expect(isNetworkFailure(new Error('connect ECONNREFUSED 127.0.0.1:8080'))).toBe(true);
  });

  it('does not treat an application error as the backend being down', () => {
    // A 404 on one entry says nothing about the next one — latching on it would take the whole
    // site static because a single slug was mistyped.
    expect(isNetworkFailure(new Error('Entry not found'))).toBe(false);
    expect(isNetworkFailure(new Error('401 Unauthorized'))).toBe(false);
  });
});

describe('configuration', () => {
  it('reports no backend when any connection value is missing', () => {
    expect(createBackend({ ...CONNECTION, workspaceSlug: '' }).hasBackend()).toBe(false);
    expect(createBackend({ env: {}, logger: quietLogger }).hasBackend()).toBe(false);
  });

  it('reads connection values from the supplied env', () => {
    const backend = createBackend({
      logger: quietLogger,
      env: {
        MARVIN_API_URL: 'http://marvin.test',
        MARVIN_SITE_CLIENT_TOKEN: 'site_client_test',
        MARVIN_WORKSPACE_SLUG: 'test-workspace',
      },
    });

    expect(backend.hasBackend()).toBe(true);
    expect(backend.config.workspaceSlug).toBe('test-workspace');
  });

  it('throws a directive error when the client is requested unconfigured', () => {
    expect(() => createBackend({ env: {}, logger: quietLogger }).client()).toThrow(
      /MARVIN_API_URL/
    );
  });
});

describe('failure latch', () => {
  function latchedBackend(now: () => number, retryAfterMs: number) {
    const fake = createFakeClient({ throws: networkError() });
    const backend = createBackend({
      ...CONNECTION,
      retryAfterMs,
      now,
      createClient: () => fake.client,
    });
    return { backend, fetcher: createFetcher(backend), fake };
  }

  it('engages on a network failure and short-circuits later calls', async () => {
    let clock = 0;
    const { backend, fetcher, fake } = latchedBackend(() => clock, 30_000);

    expect(await fetcher.collections()).toEqual([]);
    expect(backend.isLatched()).toBe(true);

    // The second call must not reach the client at all — that is the whole point during a
    // static build, where the alternative is one timeout per path.
    expect(await fetcher.collections()).toEqual([]);
    expect(fake.countOf('collections.list')).toBe(1);
  });

  it('stays latched for the whole retry window', async () => {
    let clock = 0;
    const { backend, fetcher } = latchedBackend(() => clock, 30_000);

    await fetcher.collections();
    clock = 29_999;

    expect(backend.hasBackend()).toBe(false);
  });

  it('expires after retryAfterMs so a recovered backend is used again', async () => {
    let clock = 0;
    let failing = true;
    const backend = createBackend({
      ...CONNECTION,
      retryAfterMs: 30_000,
      now: () => clock,
      createClient: () => ({
        collections: {
          list: async () => {
            if (failing) throw networkError();
            return [{ slug: 'projects' }];
          },
        },
      }),
    });
    const fetcher = createFetcher(backend);

    await fetcher.collections();
    expect(backend.isLatched()).toBe(true);

    clock = 30_001;
    failing = false;

    expect(backend.hasBackend()).toBe(true);
    expect(await fetcher.collections()).toEqual([{ slug: 'projects' }]);
  });

  it('never expires when retryAfterMs is Infinity (the production build default)', async () => {
    let clock = 0;
    const { backend, fetcher } = latchedBackend(() => clock, Number.POSITIVE_INFINITY);

    await fetcher.collections();
    clock = 1e12;

    expect(backend.hasBackend()).toBe(false);
  });

  it('does not latch on an application error', async () => {
    const fake = createFakeClient({ throws: new Error('404 Not Found') });
    const backend = createBackend({ ...CONNECTION, createClient: () => fake.client });
    const fetcher = createFetcher(backend);

    expect(await fetcher.entry('missing')).toBeNull();
    expect(backend.isLatched()).toBe(false);
    expect(backend.hasBackend()).toBe(true);
  });

  it('clearLatch re-opens it immediately', async () => {
    let clock = 0;
    const { backend, fetcher } = latchedBackend(() => clock, Number.POSITIVE_INFINITY);

    await fetcher.collections();
    expect(backend.isLatched()).toBe(true);

    backend.clearLatch();
    expect(backend.isLatched()).toBe(false);
  });
});

describe('fetcher guards', () => {
  it('returns empty values instead of throwing when the backend is absent', async () => {
    const backend = createBackend({ env: {}, logger: quietLogger });
    const fetcher = createFetcher(backend);

    expect(await fetcher.collections()).toEqual([]);
    expect(await fetcher.entry('anything')).toBeNull();
    expect(await fetcher.site()).toBeNull();
    expect(await fetcher.collectionEntriesFallback(['a', 'b'])).toEqual([]);
  });
});

describe('requireBackend', () => {
  function strict(fake: ReturnType<typeof createFakeClient>, extra: Record<string, unknown> = {}) {
    const backend = createBackend({ ...CONNECTION, requireBackend: true, createClient: () => fake.client, ...extra });
    return { backend, fetcher: createFetcher(backend) };
  }

  it('throws instead of falling back when Marvin is unreachable, so a deploy build fails', async () => {
    const { backend, fetcher } = strict(createFakeClient({ throws: networkError() }));

    await expect(fetcher.collections()).rejects.toBeInstanceOf(MarvinUnavailableError);
    expect(backend.isLatched()).toBe(false); // never latched: there is nothing to fall back to
  });

  it('throws when Marvin is not configured', () => {
    const backend = createBackend({ env: {}, logger: quietLogger, requireBackend: true });

    expect(() => backend.hasBackend()).toThrow(MarvinUnavailableError);
  });

  it('throws when Marvin rejects the site token (expired, revoked, missing a permission)', async () => {
    for (const error of [new Error('401 Unauthorized'), new Error('403 Forbidden'), Object.assign(new Error('nope'), { statusCode: 401 })]) {
      const { fetcher } = strict(createFakeClient({ throws: error }));
      await expect(fetcher.collections()).rejects.toThrow(/rejected the site token/);
    }
  });

  it('leaves a rejected token an ordinary error when off', async () => {
    const backend = createBackend({ ...CONNECTION, createClient: () => createFakeClient({ throws: new Error('401 Unauthorized') }).client });
    await expect(createFetcher(backend).collections()).resolves.toEqual([]);
  });

  it('still lets an application error (a missing entry) through to its usual handling', async () => {
    const { fetcher } = strict(createFakeClient({ throws: new Error('404 Not Found') }));

    await expect(fetcher.collections()).resolves.toEqual([]);
  });

  it('is read from MARVIN_REQUIRE_BACKEND and is off by default', () => {
    const env = { MARVIN_API_URL: 'http://marvin.test', MARVIN_SITE_CLIENT_TOKEN: 't', MARVIN_WORKSPACE_SLUG: 'w' };
    expect(createBackend({ logger: quietLogger, env: { ...env, MARVIN_REQUIRE_BACKEND: 'true' } }).config.requireBackend).toBe(true);
    expect(createBackend({ logger: quietLogger, env }).config.requireBackend).toBe(false);
  });

  it('falls back as before when off', async () => {
    const backend = createBackend({ ...CONNECTION, createClient: () => createFakeClient({ throws: networkError() }).client });

    await expect(createFetcher(backend).collections()).resolves.toEqual([]);
    expect(backend.isLatched()).toBe(true);
  });
});
