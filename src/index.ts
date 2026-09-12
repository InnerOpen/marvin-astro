/**
 * `@inneropen/marvin-astro` — site integration for Marvin CMS.
 *
 * Sits above `@inneropen/marvin-sdk` (transport) and beside `@inneropen/marvin-renderers-core`
 * (entry-type → component mapping). This layer is the part every Marvin-backed site rewrites:
 * repositories with a static fallback, site chrome from collections, and payload normalization.
 *
 * ```ts
 * // src/lib/content.ts
 * export const marvin = createMarvinContent({ site: { fallback: staticSite } });
 *
 * export const posts = marvin.repository({
 *   collections: ['bench-notes', 'journal', 'blog'],
 *   hydrate: true,
 *   href: (slug) => `/bench-notes/${slug}`,
 *   fallback: () => staticPosts,
 *   transform: async (entry, f) => ({
 *     slug: entry.slug,
 *     title: entry.title ?? 'Untitled',
 *     noteNumber: f.string('noteNumber'),
 *     bodyHtml: await f.markdown('body'),
 *     image: f.image({ roles: ['hero', 'featured', 'card'] }),
 *   }),
 * });
 * ```
 */

import { createBackend } from './client.js';
import { createChromeLoader, type ChromeOptions } from './chrome.js';
import { createFetcher } from './fetch.js';
import { createMarkdownRenderer } from './markdown.js';
import { createRepository, type Repository, type RepositoryOptions } from './repository.js';
import { loadSectionLanding, type SectionLandingOptions } from './sections.js';
import { createSiteLoader, type SiteOptions } from './site.js';
import type { MarvinAstroConfig } from './config.js';
import type { ApiSite, ApiSiteChrome, SectionLanding } from './types.js';

export type MarvinContentOptions = MarvinAstroConfig & {
  site?: SiteOptions;
  chrome?: ChromeOptions;
};

export type MarvinContent = ReturnType<typeof createMarvinContent>;

/**
 * Build the content layer for one Marvin workspace.
 *
 * Connection settings come from `MARVIN_API_URL`, `MARVIN_SITE_CLIENT_TOKEN` and
 * `MARVIN_WORKSPACE_SLUG` unless passed explicitly. Everything returned degrades to its static
 * fallback when the backend is unreachable, so a site still builds offline.
 */
export function createMarvinContent(options: MarvinContentOptions = {}) {
  const backend = createBackend(options);
  const fetcher = createFetcher(backend);
  const renderMarkdown = createMarkdownRenderer(backend.config.markdown);
  const siteLoader = createSiteLoader(fetcher, options.site);
  const chromeLoader = createChromeLoader(fetcher, siteLoader, options.chrome);
  const repositories: Repository<unknown>[] = [];

  return {
    /** The resolved configuration, with the token still in place — don't log it. */
    config: backend.config,
    /** Latch control and the raw SDK client. */
    backend,
    /** Guarded, never-throwing wrappers around every published endpoint. */
    fetch: fetcher,
    renderMarkdown,

    /** True when Marvin is configured and not currently latched out as unreachable. */
    hasBackend: () => backend.hasBackend(),

    /** Resolved site identity, SEO and brand assets. Memoized per process. */
    getSite(): Promise<ApiSite> {
      return siteLoader.get();
    },

    /** Navigation, footer, legal, social and inquiry links. Memoized per process. */
    getSiteChrome(): Promise<ApiSiteChrome> {
      return chromeLoader.get();
    },

    /** Title/intro/hero for an index page, driven by a `page` entry of the same slug. */
    getSectionLanding(slug: string, sectionOptions?: SectionLandingOptions): Promise<SectionLanding> {
      return loadSectionLanding(fetcher, slug, renderMarkdown, sectionOptions);
    },

    /** A collection-backed content repository: `all()` / `bySlug()` / `featured()`. */
    repository<T>(repositoryOptions: RepositoryOptions<T>): Repository<T> {
      const repository = createRepository<T>({ fetcher, renderMarkdown }, repositoryOptions);
      repositories.push(repository as Repository<unknown>);
      return repository;
    },

    /** Drop every memoized result and re-open the failure latch. */
    reset() {
      backend.clearLatch();
      siteLoader.reset();
      chromeLoader.reset();
      for (const repository of repositories) repository.reset();
    },
  };
}

export {
  createBackend,
  errorMessage,
  isNetworkFailure,
  type MarvinBackend,
} from './client.js';
export {
  DEFAULT_DEV_RETRY_MS,
  DEFAULT_HYDRATE_CONCURRENCY,
  ENV_KEYS,
  describeConfig,
  readEnv,
  resolveConfig,
  type MarvinAstroConfig,
  type MarvinLogger,
  type ResolvedConfig,
} from './config.js';
export { createFetcher, type HydratedEntry, type MarvinFetcher } from './fetch.js';
export {
  createFieldAccessor,
  type FieldAccessor,
  type IconFieldOptions,
  type ImageFieldOptions,
  type MarkdownFieldOptions,
  type ResourceFieldOptions,
} from './fields.js';
export { formatDisplayDate, selectValuesForPage } from './format.js';
export {
  createMarkdownRenderer,
  preserveSoftBreaks,
  type MarkdownOptions,
  type MarkdownRenderer,
} from './markdown.js';
export * from './normalize.js';
export {
  createRepository,
  type Repository,
  type RepositoryContext,
  type RepositoryOptions,
} from './repository.js';
export {
  buildFallbackSite,
  buildSeo,
  createSiteLoader,
  type SiteLoader,
  type SiteOptions,
} from './site.js';
export {
  createChromeLoader,
  defaultResolveHref,
  metadataLink,
  socialLinkFromKey,
  toNavigationLink,
  type ChromeLoader,
  type ChromeOptions,
  type HrefContext,
  type NavigationContext,
  type NavigationLinkInput,
  type ResolveHref,
  type SocialLinkInput,
} from './chrome.js';
export { loadSectionLanding, type SectionLandingOptions } from './sections.js';
export type * from './types.js';
