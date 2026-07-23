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
   * Turn list items into full entries.
   *
   * The collection endpoint returns `PublishedEntryListItem` — core fields plus
   * `metadata_json`, but NOT `data_json`. `PublishedEntryRead` (the single-entry endpoint)
   * includes it. So any field defined by the entry type's schema is unreadable from a list
   * item; it only appears after this hydration pass. Items that already carry data are passed
   * through untouched.
   */
  async function hydrate(entries: MarvinContentEntry[]): Promise<HydratedEntry[]> {
    const hydrated = await Promise.all(
      entries.map(async (item) => {
        if (
          typeof (item as { field?: unknown }).field === 'function' ||
          'data' in item ||
          'dataJson' in item
        ) {
          return item as HydratedEntry;
        }
        return entry(item.slug ?? '');
      })
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

    async hydratedCollectionEntries(slug: string): Promise<HydratedEntry[]> {
      return hydrate(await this.collectionEntries(slug));
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
