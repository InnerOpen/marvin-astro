/**
 * Site chrome: main nav, footer columns, legal strip, social links, inquiry link.
 *
 * All of it comes from ordinary Marvin collections, so a workspace can reorder its own
 * navigation without a deploy. Every piece has a static fallback for when the backend is down.
 */

import type { MarvinFetcher, HydratedEntry } from './fetch.js';
import {
  asRecord,
  asString,
  collectionRole,
  collectionSlugs,
  entryField,
  isExternalHref,
} from './normalize.js';
import type { SiteLoader } from './site.js';
import type {
  ApiNavigationLink,
  ApiSite,
  ApiSiteChrome,
  ApiSocialLink,
  MarvinContentEntry,
} from './types.js';

export type NavigationContext = 'main' | 'footer';

export type HrefContext = {
  /** Where this link is being rendered. */
  context: NavigationContext;
  /** The nav collection the entry was read from. */
  collectionSlug: string;
  slug: string;
  /** Every collection the entry belongs to, nav collections included. */
  collections: string[];
  /** The collection slugs treated as navigation, i.e. not route prefixes. */
  navCollections: Set<string>;
};

export type ResolveHref = (entry: MarvinContentEntry, context: HrefContext) => string;

/** A link authored in site code rather than in the CMS. */
export type NavigationLinkInput = {
  label: string;
  href: string;
  description?: string;
  role?: string;
};

export type SocialLinkInput = NavigationLinkInput & { icon: string };

export type ChromeOptions = {
  /** Collection holding the main nav. Default `'main-navigation'`. */
  mainCollection?: string;
  /** Collection holding the footer nav. Default `'footer-navigation'`. */
  footerCollection?: string;
  /**
   * Collection holding the social links. Default `'social-links'`. When it has entries, they
   * (label, href, optional `icon` field) are exactly the social links, in order; otherwise the
   * site `social` map is used.
   */
  socialCollection?: string;
  /**
   * Route for a nav entry that carries no explicit `href`/`url`/`path` field.
   *
   * The default prefixes the entry's own (non-navigation) collection: an entry in
   * `workshop-reference` becomes `/workshop-reference/<slug>`, and an entry in no other
   * collection becomes `/<slug>`. Override when routes don't mirror collections.
   */
  resolveHref?: ResolveHref;
  /** Membership role that marks a footer link as legal (Terms, Privacy…). Default `'legal'`. */
  legalRole?: string;
  /** Footer links per column once split. Columns are only created above this count. */
  footerColumnThreshold?: number;
  fallback?: {
    mainNavigation?: NavigationLinkInput[];
    footerNavigation?: NavigationLinkInput[][];
    legalLinks?: NavigationLinkInput[];
    socialLinks?: SocialLinkInput[];
    inquiry?: NavigationLinkInput;
  };
};

export function toNavigationLink(link: NavigationLinkInput): ApiNavigationLink {
  return {
    label: link.label,
    href: link.href,
    description: link.description,
    external: isExternalHref(link.href),
    role: link.role,
  };
}

/** Collection-prefixed routing: `/<owning-collection>/<slug>`, else `/<slug>`. */
export const defaultResolveHref: ResolveHref = (_entry, context) => {
  const owning = context.collections.find((slug) => !context.navCollections.has(slug));
  return owning ? `/${owning}/${context.slug}` : `/${context.slug}`;
};

/** A `{label, href}` object stored loose in site metadata (e.g. `metadata.inquiry`). */
export function metadataLink(value: unknown): ApiNavigationLink | undefined {
  const link = asRecord(value);
  const label = asString(link.label);
  const href = asString(link.href);
  if (!label || !href) return undefined;

  return {
    label,
    href,
    description: asString(link.description) ?? asString(link.subject),
    external: isExternalHref(href),
  };
}

/** Title-case a social key: `x_handle` → `X Handle`, `email` → `Email`. */
function socialLabel(key: string): string {
  return key.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function socialLinkFromKey(key: string, href: string): ApiSocialLink {
  return {
    label: socialLabel(key),
    href,
    icon: key,
    external: isExternalHref(href),
  };
}

/**
 * Icon key for a social link with no `icon` field: `mailto:` → `email`, else the network's
 * name from the host (`www.instagram.com` → `instagram`, `x.com` → `x`), else the label.
 */
export function socialIconFor(href: string, label: string): string {
  if (href.startsWith('mailto:')) return 'email';
  try {
    const host = new URL(href).hostname.replace(/^(www|m)\./, '');
    return host.split('.')[0] ?? label.toLowerCase();
  } catch {
    return label.toLowerCase();
  }
}

export type ChromeLoader = {
  get(): Promise<ApiSiteChrome>;
  reset(): void;
};

export function createChromeLoader(
  fetcher: MarvinFetcher,
  siteLoader: SiteLoader,
  options: ChromeOptions = {}
): ChromeLoader {
  const mainCollection = options.mainCollection ?? 'main-navigation';
  const footerCollection = options.footerCollection ?? 'footer-navigation';
  const socialCollection = options.socialCollection ?? 'social-links';
  const legalRole = options.legalRole ?? 'legal';
  const footerColumnThreshold = options.footerColumnThreshold ?? 4;
  const resolveHref = options.resolveHref ?? defaultResolveHref;
  const navCollections = new Set([mainCollection, footerCollection, socialCollection]);
  const fallback = options.fallback ?? {};

  let promise: Promise<ApiSiteChrome> | null = null;

  function entryToLink(
    entry: HydratedEntry,
    collectionSlug: string,
    context: NavigationContext
  ): ApiNavigationLink {
    const slug = entry.slug ?? '';
    const href =
      asString(entryField(entry, 'href')) ??
      asString(entryField(entry, 'url')) ??
      asString(entryField(entry, 'path')) ??
      resolveHref(entry, {
        context,
        collectionSlug,
        slug,
        collections: collectionSlugs(entry),
        navCollections,
      });
    const label =
      asString(entryField(entry, 'label')) ??
      asString(asRecord((entry as { metadataJson?: unknown }).metadataJson).label) ??
      asString(entry.title) ??
      href;

    return {
      label,
      href,
      description:
        asString(entry.summary) ?? asString((entry as { description?: unknown }).description),
      external: isExternalHref(href),
      role: collectionRole(entry, collectionSlug),
    };
  }

  async function navigationCollection(
    slug: string,
    context: NavigationContext,
    online: boolean
  ): Promise<{ links: ApiNavigationLink[]; entries: HydratedEntry[] }> {
    if (!online) return { links: [], entries: [] };

    // Hydrated: a nav entry's `href`/`label` overrides are schema fields, absent from list items.
    // Empty, hidden or missing all read as empty: Marvin is up, so its answer is final.
    const entries = await fetcher.hydratedCollectionEntries(slug);
    return { links: entries.map((entry) => entryToLink(entry, slug, context)), entries };
  }

  function groupFooterLinks(links: ApiNavigationLink[]): ApiNavigationLink[][] {
    if (links.length <= footerColumnThreshold) return [links];

    const midpoint = Math.ceil(links.length / 2);
    return [links.slice(0, midpoint), links.slice(midpoint)];
  }

  /** The social-links collection as links, or null when it has no entries. */
  async function socialEntries(online: boolean): Promise<ApiSocialLink[] | null> {
    const social = await navigationCollection(socialCollection, 'footer', online);
    if (social.links.length === 0) return null;

    return social.links.map((link, index) => ({
      ...link,
      icon:
        asString(entryField(social.entries[index], 'icon')) ?? socialIconFor(link.href, link.label),
    }));
  }

  /** The site `social` map plus the contact email; offline, the static social links if both are empty. */
  function siteSocialLinks(site: ApiSite, online: boolean): ApiSocialLink[] {
    const links = Object.entries(site.social).map(([key, href]) => socialLinkFromKey(key, href));
    if (site.email && !links.some((link) => link.icon === 'email')) {
      links.push(socialLinkFromKey('email', `mailto:${site.email}`));
    }
    if (links.length > 0 || online) return links;

    return (fallback.socialLinks ?? []).map((link) => ({
      ...toNavigationLink(link),
      icon: link.icon,
    }));
  }

  async function load(): Promise<ApiSiteChrome> {
    const site = await siteLoader.get();
    const staticMain = (fallback.mainNavigation ?? []).map(toNavigationLink);
    const staticFooter = (fallback.footerNavigation ?? []).map((group) =>
      group.map(toNavigationLink)
    );

    // The build's one "is Marvin up?" check: online, Marvin's content is final everywhere below;
    // offline, every part of the chrome is the static fallback.
    const online = await siteLoader.online();
    const main = await navigationCollection(mainCollection, 'main', online);
    const footer = await navigationCollection(footerCollection, 'footer', online);

    const social = await socialEntries(online);

    // Split footer links by membership role: legal → the legal strip; everything else → columns.
    const columnLinks = footer.links.filter((link) => link.role !== legalRole);
    const staticLegal = (fallback.legalLinks ?? []).map(toNavigationLink);

    return {
      site,
      mainNavigation: online ? main.links : staticMain,
      footerNavigation: online ? groupFooterLinks(columnLinks) : staticFooter,
      legalLinks: online ? footer.links.filter((link) => link.role === legalRole) : staticLegal,
      socialLinks: social ?? siteSocialLinks(site, online),
      inquiry: online
        ? metadataLink(site.metadata.inquiry)
        : fallback.inquiry && toNavigationLink(fallback.inquiry),
    };
  }

  return {
    get() {
      promise ??= load();
      return promise;
    },
    reset() {
      promise = null;
    },
  };
}
