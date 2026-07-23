/**
 * Site-integration types.
 *
 * These are the *resolved* shapes a site renders from — Marvin's raw payloads normalized,
 * defaulted, and made non-optional where a template would otherwise need a guard on every
 * use. Nothing here is specific to a particular site's design system.
 */

import type {
  CollectionEntry,
  Entry,
  MarvinEntry,
  MarvinEntryListItem,
} from '@inneropen/marvin-sdk';

/**
 * Any entry shape the published API can hand back. `MarvinEntry`/`Entry` carry `data_json`;
 * `CollectionEntry`/`MarvinEntryListItem` (list items) do not — see the `hydrate` repository
 * option.
 */
export type MarvinContentEntry = MarvinEntry | Entry | CollectionEntry | MarvinEntryListItem;

/** Criteria for picking one asset off an entry's `assets[]`. */
export type AssetSelectOptions = {
  role?: string;
  roles?: string[];
  usage?: string;
  usages?: string[];
  type?: string;
  types?: string[];
  mimeType?: string;
  /** Also accept assets carrying neither a role nor a usage. */
  allowUnroled?: boolean;
};

/** A resolved image: a URL plus the presentation hints stored alongside the asset. */
export type ApiImage = {
  src: string;
  alt: string;
  /** CSS `object-position` value, e.g. `"40% 65%"`. */
  focalPoint?: string;
};

/** A resolved link to an attached resource (material, construction detail, document…). */
export type ApiResourceLink = {
  name: string;
  /** The resource type, e.g. `'material'`, `'construction'`. */
  type: string;
  /** The relationship role, e.g. `'primary-material'`. */
  role?: string;
  slug?: string;
  href?: string;
};

/**
 * Resolved SEO / social-sharing metadata for the site. Mirrors Marvin's SiteSeo, with identity
 * fallbacks already applied (title/description/siteName never empty). The rendering layer
 * (SeoHead) turns this into the actual `<meta>`/Open Graph/Twitter tags.
 */
export type ApiSeo = {
  title: string;
  titleTemplate?: string;
  description: string;
  keywords: string[];
  robots: string;
  image?: string;
  imageAlt?: string;
  ogType: string;
  siteName: string;
  twitterCard: string;
  twitterHandle?: string;
  twitterCreator?: string;
  fbAppId?: string;
  themeColor?: string;
  publisher?: string;
  canonicalUrl?: string;
  verification: {
    google?: string;
    bing?: string;
    pinterest?: string;
    yandex?: string;
  };
};

export type ApiSite = {
  workspaceSlug?: string;
  workspaceName?: string;
  name: string;
  title: string;
  tagline?: string;
  description: string;
  canonicalUrl?: string;
  logo?: string;
  favicon?: string;
  /** Round maker's stamp / seal — resolved from `site_metadata_json.brand.seal` (asset slug). */
  seal?: string;
  /**
   * Brand-asset registry: every `site_metadata_json.brand.<name>` slug resolved to its URL.
   * Add a shared asset with one config line; components read `site.brand.<name>`.
   */
  brand?: Record<string, string>;
  locale: string;
  timezone: string;
  email?: string;
  imprint?: string;
  social: Record<string, string>;
  seo: ApiSeo;
  metadata: Record<string, unknown>;
};

export type ApiNavigationLink = {
  label: string;
  href: string;
  description?: string;
  external: boolean;
  /** Membership role from the nav collection (e.g. `'primary'`, `'legal'`). Drives grouping. */
  role?: string;
};

export type ApiSocialLink = ApiNavigationLink & {
  icon: string;
};

export type ApiSiteChrome = {
  site: ApiSite;
  mainNavigation: ApiNavigationLink[];
  footerNavigation: ApiNavigationLink[][];
  /** Legal links (`role: 'legal'` in the footer nav collection), e.g. Terms/Privacy. */
  legalLinks: ApiNavigationLink[];
  socialLinks: ApiSocialLink[];
  inquiry?: ApiNavigationLink;
};

export type ApiActionVariant = 'primary' | 'secondary';

export type ApiPageAction = ApiNavigationLink & {
  variant: ApiActionVariant;
};

export type ApiHeroAction = ApiPageAction;

export type ApiHero = {
  kicker: string;
  headline: string;
  body: string;
  actions: ApiHeroAction[];
  layout: 'split' | 'centered';
  image?: {
    src?: string;
    alt: string;
    focalPoint?: string;
    dominantColor?: string;
    fit?: 'cover' | 'contain';
    caption?: string;
    credit?: string;
    orientation?: string;
  };
};

/**
 * A section-landing header driven by a Marvin `page` entry (e.g. `bench-notes`, `projects`).
 * The entry is linkable in nav (collection membership) AND supplies the landing's title, intro,
 * and hero — so the top of an index page stops being static. Absent fields resolve to
 * `undefined` so callers fall back to their existing copy/illustration.
 */
export type SectionLanding = {
  title?: string;
  /** The `body` field (or summary) rendered from markdown to HTML — render with `set:html`. */
  introHtml?: string;
  hero?: string;
};
