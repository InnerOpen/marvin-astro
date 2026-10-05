/**
 * The repository factory.
 *
 * `getAll` / `getBySlug` / `getFeatured` is the same forty lines of try / fallback / memoize
 * around every content type on every site. Only the transform differs. This holds the forty
 * lines; the site writes the transform.
 */

import { errorMessage } from './client.js';
import { createFieldAccessor, type FieldAccessor } from './fields.js';
import { isFullEntry, type MarvinFetcher } from './fetch.js';
import type { MarkdownRenderer } from './markdown.js';
import type { MarvinContentEntry } from './types.js';

export type RepositoryOptions<T> = {
  /** Collection slug to load from. */
  collection?: string;
  /**
   * Collection slugs tried in order; the first one that yields entries wins. Lets a site work
   * against workspaces that named the same thing `bench-notes`, `journal`, or `blog`.
   */
  collections?: string[];
  /**
   * Fetch each list item as a full entry before transforming.
   *
   * The collection endpoint returns `PublishedEntryListItem`, which has no `assets[]` or
   * `resources[]` (only their slugs) and, on older servers, no `data_json`; the single-entry
   * endpoint returns `PublishedEntryRead`, which has all of it. So if the transform reads asset
   * roles, resources, or (on an older server) any schema field, this must be `true`. The list is
   * requested with `expand=full`, which returns full entries in the one request; a server or SDK
   * without it (SDK < 4.2) costs one more request per entry. `bySlug` always works from full
   * entries either way.
   */
  hydrate?: boolean;
  /** Build the resolved item from an entry. May be async (e.g. to render markdown). */
  transform: (entry: MarvinContentEntry, fields: FieldAccessor) => T | Promise<T>;
  /** Static data to serve when Marvin is unreachable or the collection is empty. */
  fallback?: () => T[] | Promise<T[]>;
  /** Applied to Marvin and fallback results alike, so ordering doesn't depend on the source. */
  sort?: (a: T, b: T) => number;
  /** Applied to Marvin and fallback results alike. */
  filter?: (item: T) => boolean;
  /** The route an entry resolves to; exposed to the transform as `fields.href`. */
  href?: (slug: string, entry: MarvinContentEntry) => string;
  /** How to read an item's slug for `bySlug`. Defaults to `item.slug`. */
  slugOf?: (item: T) => string | undefined;
  /** How to tell whether an item is featured. Defaults to `item.featured`. */
  isFeatured?: (item: T) => boolean;
};

export type Repository<T> = {
  /** Every item, resolved once per process. */
  all(): Promise<T[]>;
  /**
   * One item by slug. Served from `all()` once that has loaded; otherwise a direct entry
   * fetch, falling back to a scan of `all()`.
   */
  bySlug(slug: string): Promise<T | undefined>;
  /** The first featured item, or the first item when none is marked. */
  featured(): Promise<T | undefined>;
  /** Every featured item, in `all()` order. */
  allFeatured(): Promise<T[]>;
  /** Drop the memoized results. Next call re-fetches. */
  reset(): void;
};

export type RepositoryContext = {
  fetcher: MarvinFetcher;
  renderMarkdown: MarkdownRenderer;
};

function defaultSlugOf<T>(item: T): string | undefined {
  const slug = (item as { slug?: unknown }).slug;
  return typeof slug === 'string' ? slug : undefined;
}

function defaultIsFeatured<T>(item: T): boolean {
  return Boolean((item as { featured?: unknown }).featured);
}

export function createRepository<T>(
  context: RepositoryContext,
  options: RepositoryOptions<T>
): Repository<T> {
  const { fetcher, renderMarkdown } = context;
  const collections = options.collections ?? (options.collection ? [options.collection] : []);
  const slugOf = options.slugOf ?? defaultSlugOf;
  const isFeatured = options.isFeatured ?? defaultIsFeatured;

  /** The loaded list, plus the slugs whose items were built from full entries. */
  type Loaded = { items: T[]; fromFullEntry: Set<string> };
  let loadedPromise: Promise<Loaded> | null = null;
  let allPromise: Promise<T[]> | null = null;
  const bySlugCache = new Map<string, Promise<T | undefined>>();

  function arrange(items: T[]): T[] {
    const filtered = options.filter ? items.filter(options.filter) : items;
    return options.sort ? [...filtered].sort(options.sort) : filtered;
  }

  function transform(entry: MarvinContentEntry, collection?: string): Promise<T> {
    const slug = (entry as { slug?: string }).slug ?? '';
    const fields = createFieldAccessor(entry, {
      renderMarkdown,
      href: options.href?.(slug, entry),
      collection,
    });
    return Promise.resolve(options.transform(entry, fields));
  }

  async function useFallback(): Promise<Loaded> {
    return { items: arrange((await options.fallback?.()) ?? []), fromFullEntry: new Set() };
  }

  async function load(): Promise<Loaded> {
    if (collections.length > 0 && fetcher.backend.hasBackend()) {
      try {
        const entries = options.hydrate
          ? await fetcher.hydratedCollectionEntriesFallback(collections)
          : await fetcher.collectionEntriesFallback(collections);

        if (entries.length > 0) {
          const items = await Promise.all(entries.map((entry) => transform(entry)));
          const fromFullEntry = new Set<string>();
          items.forEach((item, index) => {
            const slug = slugOf(item);
            if (slug !== undefined && isFullEntry(entries[index])) fromFullEntry.add(slug);
          });
          return { items: arrange(items), fromFullEntry };
        }
      } catch (error) {
        fetcher.backend.remember(error);
        fetcher.backend.warn(
          `Collection "${collections[0]}" failed, using fallback: ${errorMessage(error)}`
        );
      }
    }

    return useFallback();
  }

  function findInList(items: T[], slug: string): T | undefined {
    return items.find((item) => slugOf(item) === slug);
  }

  async function loadBySlug(slug: string): Promise<T | undefined> {
    // Once a hydrated list has loaded, every slug in it is already transformed from a full entry —
    // a per-entry fetch would be a second request for the same content (~1.4s per detail page on
    // a 280-entry site). An item built from a bare list item is NOT served: it has no assets[] or
    // resources[], so a detail page would lose its role-picked images and resource links.
    let listed: T | undefined;
    if (loadedPromise) {
      const loaded = await loadedPromise;
      listed = findInList(loaded.items, slug);
      if (listed && loaded.fromFullEntry.has(slug)) return listed;
    }

    if (fetcher.backend.hasBackend()) {
      try {
        const entry = await fetcher.entry(slug);
        if (entry) return await transform(entry);
      } catch (error) {
        fetcher.backend.remember(error);
        fetcher.backend.warn(`Entry "${slug}" failed, using fallback: ${errorMessage(error)}`);
      }
    }

    // No backend, no such entry, or a transform that blew up: fall back to the resolved list,
    // which is either Marvin's or the static data — the caller doesn't need to care which.
    return listed ?? findInList(await all(), slug);
  }

  function all(): Promise<T[]> {
    if (!allPromise) {
      loadedPromise = load();
      allPromise = loadedPromise.then((loaded) => loaded.items);
    }
    return allPromise;
  }

  return {
    all,

    bySlug(slug: string): Promise<T | undefined> {
      let cached = bySlugCache.get(slug);
      if (!cached) {
        cached = loadBySlug(slug);
        bySlugCache.set(slug, cached);
      }
      return cached;
    },

    async allFeatured(): Promise<T[]> {
      return (await all()).filter(isFeatured);
    },

    async featured(): Promise<T | undefined> {
      const items = await all();
      return items.find(isFeatured) ?? items[0];
    },

    reset() {
      allPromise = null;
      loadedPromise = null;
      bySlugCache.clear();
    },
  };
}
