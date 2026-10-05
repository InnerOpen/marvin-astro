import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarvinBackend } from '../src/client.js';
import { createFetcher, isFullEntry } from '../src/fetch.js';
import type { MarvinContentEntry } from '../src/types.js';
import { asEntry, listItemOf, projectRead } from './support/fixtures.js';

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

describe('isFullEntry', () => {
  it('is true for a full read: assets[] / resources[] placements, or the SDK Entry wrapper', () => {
    expect(isFullEntry(projectRead)).toBe(true);
    expect(isFullEntry({ slug: 'a', data: {}, assets: [], resources: [] })).toBe(true);
    expect(isFullEntry(asEntry(projectRead))).toBe(true);
  });

  it('is false for a list item, even one that carries data', () => {
    expect(isFullEntry(listItemOf(projectRead))).toBe(false);
    expect(isFullEntry({ slug: 'a', data: { x: 1 } })).toBe(false);
    expect(isFullEntry({ slug: 'a', data: {}, assets: [], assetSlugs: [] })).toBe(false);
    expect(isFullEntry({ slug: 'a' })).toBe(false);
    expect(isFullEntry(null)).toBe(false);
  });
});

describe('createFetcher — hydrate', () => {
  it('re-reads list items — with or without data — and passes full entries through', async () => {
    const full = { slug: 'full', data: { x: 1 }, assets: [], resources: [] };
    const listItemWithData = { slug: 'listed', data: { x: 1 }, assetSlugs: ['a'], resourceSlugs: [] };
    const bare = { slug: 'bare' };
    const reads: string[] = [];
    const client = {
      entry: async (slug: string) => {
        reads.push(slug);
        return { slug, fetched: true };
      },
    };
    const { backend } = makeBackend({ client });

    const out = await createFetcher(backend).hydrate([
      full,
      listItemWithData,
      bare,
    ] as unknown as MarvinContentEntry[]);

    expect(out).toContainEqual(full);
    expect(out).toContainEqual({ slug: 'listed', fetched: true });
    expect(out).toContainEqual({ slug: 'bare', fetched: true });
    expect(reads.sort()).toEqual(['bare', 'listed']);
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
