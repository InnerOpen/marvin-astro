import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarvinBackend } from '../src/client.js';
import { createFetcher } from '../src/fetch.js';
import type { MarvinContentEntry } from '../src/types.js';

function makeBackend(opts: { hasBackend?: boolean; client?: unknown; latched?: boolean } = {}) {
  const remembered: unknown[] = [];
  const warnings: string[] = [];
  const latchCalls: string[] = [];
  let latched = opts.latched ?? false;
  const backend = {
    config: { hydrateConcurrency: 6 },
    hasBackend: () => opts.hasBackend ?? true,
    client: () => opts.client ?? {},
    remember: (error: unknown) => remembered.push(error),
    warn: (message: string) => warnings.push(message),
    isLatched: () => {
      latchCalls.push('isLatched');
      return latched;
    },
    clearLatch: () => {
      latchCalls.push('clearLatch');
      latched = false;
    },
  } as unknown as MarvinBackend;
  return { backend, remembered, warnings, latchCalls };
}

/** A hydrate that runs its retry backoff on fake timers, so the tests don't wait on it. */
async function hydrateNow(backend: MarvinBackend, entries: MarvinContentEntry[]) {
  const pending = createFetcher(backend).hydrate(entries);
  await vi.runAllTimersAsync();
  return pending;
}

describe('createFetcher — the guarded wrapper', () => {
  it('skips the call and returns the empty value when there is no backend', async () => {
    const throwing = {
      collections: {
        list: () => {
          throw new Error('must not be called');
        },
      },
    };
    const { backend } = makeBackend({ hasBackend: false, client: throwing });
    expect(await createFetcher(backend).collections()).toEqual([]);
  });

  it('catches an error, remembers it for the latch, warns once, and returns empty', async () => {
    const client = {
      collections: {
        list: async () => {
          throw new Error('boom');
        },
      },
    };
    const { backend, remembered, warnings } = makeBackend({ client });
    expect(await createFetcher(backend).collections()).toEqual([]);
    expect(remembered).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Collections');
    expect(warnings[0]).toContain('boom');
  });

  it('returns the client result on the happy path', async () => {
    const client = { collections: { list: async () => [{ slug: 'a' }] } };
    const { backend } = makeBackend({ client });
    expect(await createFetcher(backend).collections()).toEqual([{ slug: 'a' }]);
  });
});

describe('createFetcher — collectionEntriesFallback', () => {
  it('returns the first slug that yields entries', async () => {
    const client = {
      collections: { entries: async (slug: string) => (slug === 'b' ? [{ slug: 'x' }] : []) },
    };
    const { backend } = makeBackend({ client });
    expect(await createFetcher(backend).collectionEntriesFallback(['a', 'b', 'c'])).toEqual([{ slug: 'x' }]);
  });

  it('returns empty when no slug yields entries', async () => {
    const client = { collections: { entries: async () => [] } };
    const { backend } = makeBackend({ client });
    expect(await createFetcher(backend).collectionEntriesFallback(['a', 'b'])).toEqual([]);
  });
});

describe('createFetcher — hydrate', () => {
  it('passes through items with data and fetches full entries for bare list items', async () => {
    const full = { slug: 'full', data: { x: 1 } } as unknown as MarvinContentEntry;
    const bare = { slug: 'bare' } as unknown as MarvinContentEntry;
    const client = { entry: async (slug: string) => ({ slug, fetched: true }) };
    const { backend } = makeBackend({ client });

    const out = await createFetcher(backend).hydrate([full, bare]);
    expect(out).toContainEqual({ slug: 'full', data: { x: 1 } });
    expect(out).toContainEqual({ slug: 'bare', fetched: true });
  });
});

describe('createFetcher — hydrate retries', () => {
  const bare = (slug: string) => ({ slug }) as unknown as MarvinContentEntry;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a transient failure, re-opens the latch first, and keeps the item', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const client = {
      entry: async (slug: string) => {
        attempts += 1;
        if (attempts === 1) throw new Error('Network error: fetch failed');
        return { slug, fetched: true };
      },
    };
    const { backend, remembered, warnings, latchCalls } = makeBackend({ client, latched: true });

    const out = await hydrateNow(backend, [bare('a')]);

    expect(out).toEqual([{ slug: 'a', fetched: true }]);
    expect(attempts).toBe(2);
    expect(latchCalls).toEqual(['isLatched', 'clearLatch']);
    expect(remembered).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('drops only the item that fails every attempt, and warns once for it', async () => {
    vi.useFakeTimers();
    const attempts: Record<string, number> = {};
    const client = {
      entry: async (slug: string) => {
        attempts[slug] = (attempts[slug] ?? 0) + 1;
        if (slug === 'bad') throw new Error('boom');
        return { slug, fetched: true };
      },
    };
    const { backend, remembered, warnings } = makeBackend({ client });

    const out = await hydrateNow(backend, [bare('a'), bare('bad'), bare('b')]);

    expect(out).toEqual([
      { slug: 'a', fetched: true },
      { slug: 'b', fetched: true },
    ]);
    expect(attempts).toEqual({ a: 1, bad: 3, b: 1 });
    expect(remembered).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"bad"');
    expect(warnings[0]).toContain('boom');
  });

  it('caps in-flight entry reads at hydrateConcurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const client = {
      entry: async (slug: string) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return { slug, fetched: true };
      },
    };
    const { backend } = makeBackend({ client });
    (backend.config as { hydrateConcurrency: number }).hydrateConcurrency = 3;

    const out = await createFetcher(backend).hydrate(
      Array.from({ length: 10 }, (_, i) => bare(`e${i}`))
    );

    expect(out).toHaveLength(10);
    expect(out.map((item) => (item as { slug: string }).slug)).toEqual(
      Array.from({ length: 10 }, (_, i) => `e${i}`)
    );
    expect(peak).toBe(3);
  });
});
