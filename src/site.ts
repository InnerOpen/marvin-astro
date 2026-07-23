/**
 * Site identity + SEO.
 *
 * Marvin's site configuration is optional almost everywhere; a template that had to guard every
 * field would be unreadable. This resolves it once into an `ApiSite` where title, description,
 * siteName, locale and timezone are always present, and where brand asset slugs have already
 * become URLs.
 */

import type { MarvinSite, SiteConfiguration } from '@inneropen/marvin-sdk';
import type { MarvinFetcher } from './fetch.js';
import { asRecord, asString, assetUrl } from './normalize.js';
import type { ApiSeo, ApiSite } from './types.js';

export type SiteOptions = {
  /**
   * Static identity to fall back to, field by field, when Marvin is unreachable or leaves a
   * value unset. Anything omitted here falls through to a neutral default.
   */
  fallback?: Partial<ApiSite> | (() => Partial<ApiSite>);
  /** Default locale when neither Marvin nor the fallback sets one. Default `'en-US'`. */
  defaultLocale?: string;
  /** Default timezone when neither Marvin nor the fallback sets one. Default `'UTC'`. */
  defaultTimezone?: string;
};

/**
 * Build resolved SEO from Marvin's raw SiteSeo block, applying identity fallbacks so title,
 * description and siteName are never empty. Absent → sensible defaults (robots `index,follow`;
 * og type `website`; large-image Twitter card).
 */
export function buildSeo(
  raw: Record<string, unknown> | undefined,
  identity: { title: string; description: string; canonicalUrl?: string; siteName: string }
): ApiSeo {
  const seo = raw ?? {};
  const verification = asRecord(seo.verification);

  return {
    title: asString(seo.title) ?? identity.title,
    titleTemplate: asString(seo.titleTemplate),
    description: asString(seo.description) ?? identity.description,
    keywords: Array.isArray(seo.keywords)
      ? seo.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
      : [],
    robots: asString(seo.robots) ?? 'index,follow',
    image: asString(seo.image),
    imageAlt: asString(seo.imageAlt),
    ogType: asString(seo.ogType) ?? 'website',
    siteName: asString(seo.siteName) ?? identity.siteName,
    twitterCard: asString(seo.twitterCard) ?? 'summary_large_image',
    twitterHandle: asString(seo.twitterHandle),
    twitterCreator: asString(seo.twitterCreator),
    fbAppId: asString(seo.fbAppId),
    themeColor: asString(seo.themeColor),
    publisher: asString(seo.publisher),
    canonicalUrl: identity.canonicalUrl,
    verification: {
      google: asString(verification.google),
      bing: asString(verification.bing),
      pinterest: asString(verification.pinterest),
      yandex: asString(verification.yandex),
    },
  };
}

function normalizeSocial(social: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asRecord(social)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0
    )
  );
}

/** The offline site: the caller's fallback, with neutral defaults under it. */
export function buildFallbackSite(options: SiteOptions = {}): ApiSite {
  const provided = typeof options.fallback === 'function' ? options.fallback() : options.fallback;
  const fallback = provided ?? {};
  const title = fallback.title ?? fallback.name ?? 'Untitled site';
  const description = fallback.description ?? '';

  return {
    ...fallback,
    name: fallback.name ?? title,
    title,
    description,
    locale: fallback.locale ?? options.defaultLocale ?? 'en-US',
    timezone: fallback.timezone ?? options.defaultTimezone ?? 'UTC',
    social: fallback.social ?? {},
    metadata: fallback.metadata ?? {},
    seo:
      fallback.seo ??
      buildSeo(undefined, { title, description, siteName: fallback.name ?? title }),
  };
}

function transformMarvinSite(marvinSite: MarvinSite, fallback: ApiSite): ApiSite {
  const config: SiteConfiguration = marvinSite.site;
  const metadata = asRecord(config.metadataJson);
  const title =
    asString(config.title) ?? asString(marvinSite.workspace?.name) ?? fallback.title;
  const description = asString(config.description) ?? fallback.description;

  return {
    workspaceSlug: asString(marvinSite.workspace?.slug),
    workspaceName: asString(marvinSite.workspace?.name),
    name: title,
    title,
    tagline: asString(config.tagline) ?? fallback.tagline,
    description,
    canonicalUrl: asString(config.canonicalUrl) ?? fallback.canonicalUrl,
    logo: asString(config.logo) ?? fallback.logo,
    favicon: asString(config.favicon) ?? fallback.favicon,
    locale: asString(config.locale) ?? fallback.locale,
    timezone: asString(config.timezone) ?? fallback.timezone,
    email: asString(config.contactEmail) ?? fallback.email,
    imprint: asString(metadata.imprint) ?? fallback.imprint,
    social: { ...fallback.social, ...normalizeSocial(config.social) },
    // Typed `config.seo` when the SDK declares it, else the raw `metadata.seo` blob — older
    // SDKs drop the typed field but pass the blob through untouched, and workspaces configured
    // before the typed field existed still only have the blob.
    seo: buildSeo(asRecord((config as { seo?: unknown }).seo ?? metadata.seo), {
      title,
      description,
      canonicalUrl: asString(config.canonicalUrl),
      siteName: title,
    }),
    metadata,
  };
}

function looksLikeAssetSlug(value: string): boolean {
  return !/^https?:\/\//.test(value) && !value.startsWith('/') && !value.startsWith('data:');
}

export type SiteLoader = {
  get(): Promise<ApiSite>;
  reset(): void;
};

export function createSiteLoader(fetcher: MarvinFetcher, options: SiteOptions = {}): SiteLoader {
  const fallback = buildFallbackSite(options);
  let promise: Promise<ApiSite> | null = null;

  async function resolveAssetSlug(slug: string | undefined): Promise<string | undefined> {
    if (!slug) return undefined;
    return assetUrl(await fetcher.asset(slug));
  }

  async function load(): Promise<ApiSite> {
    const marvinSite = await fetcher.site();
    if (!marvinSite) return fallback;

    const site = transformMarvinSite(marvinSite, fallback);

    // Brand-asset registry: resolve EVERY `brand.<name>` slug → URL in one pass. A site adds a
    // shared asset with one config line (`brand.paperFold = "paper-fold"`) plus an upload;
    // components then read `site.brand.paperFold`. No code change per asset.
    const brandPairs = Object.entries(asRecord(site.metadata.brand)).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].trim().length > 0
    );
    const resolved = await Promise.all(
      brandPairs.map(async ([name, slug]) => [name, await resolveAssetSlug(slug)] as const)
    );
    const brand: Record<string, string> = {};
    const brandBySlug = new Map<string, string>();
    for (const [index, [name, url]] of resolved.entries()) {
      if (!url) continue;
      brand[name] = url;
      brandBySlug.set(brandPairs[index][1], url);
    }

    // The og:image may be given as a bare asset slug too. It is usually one of the brand slugs
    // (a monogram, a logo), so check what was just resolved before fetching it again.
    const rawImage = site.seo.image;
    const ogImage =
      rawImage && looksLikeAssetSlug(rawImage)
        ? (brandBySlug.get(rawImage) ?? (await resolveAssetSlug(rawImage)))
        : undefined;

    return {
      ...site,
      brand,
      // Convenience aliases for common callers; all of these also live in `site.brand`.
      logo: brand.logo ?? site.logo,
      favicon: brand.favicon ?? site.favicon,
      seal: brand.seal ?? site.seal,
      seo: { ...site.seo, image: ogImage ?? site.seo.image },
    };
  }

  return {
    get() {
      // Memoized: components like a per-card brand stamp render many instances per page, so
      // this keeps brand-slug resolution to once per process rather than once per render.
      promise ??= load();
      return promise;
    },
    reset() {
      promise = null;
    },
  };
}
