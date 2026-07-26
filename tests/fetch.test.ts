import { describe, expect, it } from 'vitest';
import type { MarvinBackend } from '../src/client.js';
import { createFetcher } from '../src/fetch.js';
import type { MarvinContentEntry } from '../src/types.js';

function makeBackend(opts: { hasBackend?: boolean; client?: unknown } = {}) {
  const remembered: unknown[] = [];
  const warnings: string[] = [];
  const backend = {
    hasBackend: () => opts.hasBackend ?? true,
    client: () => opts.client ?? {},
    remember: (error: unknown) => remembered.push(error),
    warn: (message: string) => warnings.push(message),
  } as unknown as MarvinBackend;
  return { backend, remembered, warnings };
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
