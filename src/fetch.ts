/**
 * Every call into Marvin, wrapped the same way: skip when there's no backend, catch, remember
 * network failures for the latch, warn once, and return an empty value the caller can fall
 * back from. Nothing here throws.
 */

import type {
  Collection,
  CollectionEntry,
  Entry,
  MarvinAsset,
  MarvinEntry,
  MarvinResource,
  MarvinSite,
  PublishedCollectionSummary,
  Workspace,
} from '@inneropen/marvin-sdk';
import { errorMessage, type MarvinBackend } from './client.js';
import type { MarvinContentEntry } from './types.js';

/** An entry that carries `data_json` — i.e. schema fields are readable. */
export type HydratedEntry = MarvinEntry | Entry;

export type MarvinFetcher = ReturnType<typeof createFetcher>;

/**
 * `collections.entries` as SDK 4.2+ declares it: `{ expand: 'full' }` asks the server for full
 * entries (`?expand=full`) and returns them as SDK `Entry` objects. Older SDKs take only the slug
 * and ignore the option, so the same call works with any SDK in the peer range; their list items
 * are then hydrated one by one.
 */
type ExpandingCollectionEntries = (
  slug: string,
  options?: { expand?: 'full' }
) => Promise<MarvinContentEntry[]>;

/**
 * True for a full entry (`PublishedEntryRead`), false for a list item (`PublishedEntryListItem`).
 *
 * `data` doesn't tell them apart: list items carry it too now. What differs is attachments. A full
 * read has `assets[]` and `resources[]` (placement objects, always present, possibly empty); a list
 * item has only `assetSlugs` / `resourceSlugs` and a `featuredAsset`. The SDK's `Entry` wrapper
 * only ever comes from the single-entry read.
 */
export function isFullEntry(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  if (typeof (item as { field?: unknown }).field === 'function') return true;
  const raw = item as Record<string, unknown>;
  if ('assetSlugs' in raw || 'resourceSlugs' in raw) return false;
  return Array.isArray(raw.assets) || Array.isArray(raw.resources);
}

/** A failed hydration read is retried this many times in total, backing off from this base. */
export const HYDRATE_ATTEMPTS = 3;
export const HYDRATE_BACKOFF_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `Promise.all(items.map(run))` with at most `limit` calls in flight. Order is preserved. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

export function createFetcher(backend: MarvinBackend) {
  async function guarded<T>(label: string, empty: T, run: () => Promise<T>): Promise<T> {
    if (!backend.hasBackend()) return empty;
    try {
      return await run();
    } catch (error) {
      backend.remember(error);
      backend.warn(`${label} unavailable: ${errorMessage(error)}`);
      return empty;
    }
  }

  async function entry(slug: string): Promise<Entry | null> {
    return guarded(`Entry "${slug}"`, null, () => backend.client().entry(slug));
  }

  /**
   * One entry read that survives a transient failure.
   *
   * `entry()` can't be used here: `guarded` swallows the error and trips the latch, and a
   * tripped latch turns every remaining item into a silent null. So retry with backoff,
   * re-opening the latch first in case a sibling read tripped it, and only remember the
   * failure — and warn — once the attempts are spent.
   */
  async function entryForHydration(slug: string): Promise<Entry | null> {
    if (!backend.hasBackend()) return null;

    let failure: unknown;
    for (let attempt = 1; attempt <= HYDRATE_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await sleep(HYDRATE_BACKOFF_MS * 2 ** (attempt - 2));
        if (backend.isLatched()) backend.clearLatch();
      }
      try {
        return await backend.client().entry(slug);
      } catch (error) {
        failure = error;
      }
    }

    backend.remember(failure);
    backend.warn(
      `Entry "${slug}" dropped after ${HYDRATE_ATTEMPTS} attempts: ${errorMessage(failure)}`
    );
    return null;
  }

  /**
   * Turn list items into full entries.
   *
   * The collection endpoint returns `PublishedEntryListItem`: core fields, `metadata_json` and
   * (on current servers) `data`, but only asset/resource *slugs* — no `assets[]` placements (so
   * no roles: no `hero-grade` image) and no `resources[]`. `PublishedEntryRead` (the single-entry
   * endpoint) has all of it. Only items that are already full entries ({@link isFullEntry}) are
   * passed through; everything else is re-read, even when it carries `data`. A list fetched with
   * `expand=full` ({@link expandedCollectionEntries}) is all full entries, so nothing is re-read.
   *
   * Reads run at most `config.hydrateConcurrency` at a time. Unbounded, a 280-entry collection
   * fired 280 requests at once, most of which timed out and were dropped — and the first
   * timeout latched the backend off for the rest of the build.
   */
  /**
   * A collection's entries as full entries in one request, where the server and SDK support
   * `expand=full` (Marvin core with expand, `@inneropen/marvin-sdk` 4.2+). Otherwise this is
   * `collectionEntries`: list items, which {@link hydrate} reads one at a time.
   */
  function expandedCollectionEntries(slug: string): Promise<MarvinContentEntry[]> {
    return guarded(`Collection entries "${slug}"`, [], () => {
      const collections = backend.client().collections;
      const entries = collections.entries as ExpandingCollectionEntries;
      return entries.call(collections, slug, { expand: 'full' });
    });
  }

  async function hydrate(entries: MarvinContentEntry[]): Promise<HydratedEntry[]> {
    const hydrated = await mapWithConcurrency(
      entries,
      backend.config.hydrateConcurrency,
      async (item) => {
        if (isFullEntry(item)) return item as HydratedEntry;
        return entryForHydration(item.slug ?? '');
      }
    );

    return hydrated.filter((item): item is HydratedEntry => Boolean(item));
  }

  return {
    backend,

    collections(): Promise<PublishedCollectionSummary[]> {
      return guarded('Collections', [], () => backend.client().collections.list());
    },

    async collection(slug: string): Promise<Collection | null> {
      return guarded(`Collection "${slug}"`, null, async () => {
        const found = await backend.client().collections.get(slug);
        return Array.isArray(found) ? null : found;
      });
    },

    collectionEntries(slug: string): Promise<CollectionEntry[]> {
      return guarded(`Collection entries "${slug}"`, [], () =>
        backend.client().collections.entries(slug)
      );
    },

    /** Try each collection slug in order; return the first that yields entries. */
    async collectionEntriesFallback(slugs: string[]): Promise<CollectionEntry[]> {
      for (const slug of slugs) {
        const entries = await this.collectionEntries(slug);
        if (entries.length > 0) return entries;
      }
      return [];
    },

    expandedCollectionEntries,

    /** Full entries: one `expand=full` request, or per-item reads where that isn't supported. */
    async hydratedCollectionEntries(slug: string): Promise<HydratedEntry[]> {
      return hydrate(await expandedCollectionEntries(slug));
    },

    async hydratedCollectionEntriesFallback(slugs: string[]): Promise<HydratedEntry[]> {
      for (const slug of slugs) {
        const entries = await this.hydratedCollectionEntries(slug);
        if (entries.length > 0) return entries;
      }
      return [];
    },

    hydrate,
    entry,

    site(): Promise<MarvinSite | null> {
      return guarded('Site', null, () => backend.client().getSite());
    },

    workspace(): Promise<Workspace | null> {
      return guarded('Workspace', null, () => backend.client().getWorkspace());
    },

    assets(type?: string): Promise<MarvinAsset[]> {
      return guarded('Assets', [], () => backend.client().assets.list({ type }));
    },

    asset(slugOrId: string): Promise<MarvinAsset | null> {
      return guarded(`Asset "${slugOrId}"`, null, () => backend.client().assets.get(slugOrId));
    },

    resources(resourceType?: string): Promise<MarvinResource[]> {
      return guarded('Resources', [], () => backend.client().resources.list({ resourceType }));
    },
  };
}
