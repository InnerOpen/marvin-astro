/**
 * Privacy & cookie disclosures: the published `site.privacy` shape, read tolerantly.
 *
 * Marvin keeps the structured facts a privacy/cookie policy page needs (who the controller is,
 * which processors handle visitor data, which cookies and storage entries the site sets). The
 * components in this package render them and, when any entry is not strictly necessary, run a
 * consent banner.
 *
 * Declared here rather than imported from `@inneropen/marvin-sdk` so the package works with SDKs
 * that predate `site.privacy`. Both the published camelCase keys and snake_case are accepted, and
 * a malformed entry is dropped rather than failing the site build.
 */

import { asRecord, asString } from './normalize.js';

export type CookieCategory = 'necessary' | 'preferences' | 'analytics' | 'marketing';

/** The categories a visitor can switch on; `necessary` is always on and never asked. */
export type ConsentCategory = Exclude<CookieCategory, 'necessary'>;

export const COOKIE_CATEGORIES: readonly CookieCategory[] = [
  'necessary',
  'preferences',
  'analytics',
  'marketing',
];

export const CONSENT_CATEGORIES: readonly ConsentCategory[] = [
  'preferences',
  'analytics',
  'marketing',
];

/** Who is responsible for the site's data (the GDPR "controller"). */
export type PrivacyController = {
  legalName: string;
  contactEmail?: string;
  address?: string;
  euRepresentative?: string;
  dpoEmail?: string;
};

/** A third party that handles visitor data on the site's behalf. */
export type PrivacyProcessor = {
  name: string;
  purpose?: string;
  dataCategories: string[];
  region?: string;
  transferBasis?: string;
  dpaUrl?: string;
  privacyUrl?: string;
};

/** A cookie (or similar storage entry) the site sets. */
export type PrivacyCookie = {
  name: string;
  provider: string;
  purpose: string;
  duration?: string;
  category: CookieCategory;
};

export type PrivacyConsent = {
  policyEntrySlug?: string;
  cookiePolicyEntrySlug?: string;
  /** ISO date (`YYYY-MM-DD`) the disclosures were last checked. */
  lastReviewed?: string;
  /** A manual re-prompt bump: changing it asks every visitor again. */
  version?: string;
};

export type SitePrivacy = {
  controller?: PrivacyController;
  processors: PrivacyProcessor[];
  cookies: PrivacyCookie[];
  consent: PrivacyConsent;
  /** True when any cookie is not `necessary`: those need prior consent. */
  bannerRequired: boolean;
};

/** Key a field by its camelCase name, falling back to snake_case. */
function field(record: Record<string, unknown>, camel: string): unknown {
  if (record[camel] !== undefined) return record[camel];
  return record[camel.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
}

function text(record: Record<string, unknown>, camel: string): string | undefined {
  const value = asString(field(record, camel));
  return value?.trim();
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : [];
}

function readController(raw: unknown): PrivacyController | undefined {
  const value = asRecord(raw);
  const legalName = text(value, 'legalName');
  if (!legalName) return undefined;
  return {
    legalName,
    contactEmail: text(value, 'contactEmail'),
    address: text(value, 'address'),
    euRepresentative: text(value, 'euRepresentative'),
    dpoEmail: text(value, 'dpoEmail'),
  };
}

function readProcessor(value: Record<string, unknown>): PrivacyProcessor | undefined {
  const name = text(value, 'name');
  if (!name) return undefined;
  const categories = field(value, 'dataCategories');
  return {
    name,
    purpose: text(value, 'purpose'),
    dataCategories: Array.isArray(categories)
      ? categories.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      : [],
    region: text(value, 'region'),
    transferBasis: text(value, 'transferBasis'),
    dpaUrl: text(value, 'dpaUrl'),
    privacyUrl: text(value, 'privacyUrl'),
  };
}

function readCookie(value: Record<string, unknown>): PrivacyCookie | undefined {
  const name = text(value, 'name');
  if (!name) return undefined;
  const category = text(value, 'category');
  return {
    name,
    provider: text(value, 'provider') ?? '',
    purpose: text(value, 'purpose') ?? '',
    duration: text(value, 'duration'),
    // A category a newer server invented is treated as the strictest optional one, never as
    // `necessary`: it must be asked about before anything it covers loads.
    category: COOKIE_CATEGORIES.includes(category as CookieCategory)
      ? (category as CookieCategory)
      : 'marketing',
  };
}

/** True when any listed cookie needs consent. */
export function cookiesNeedConsent(cookies: readonly Pick<PrivacyCookie, 'category'>[]): boolean {
  return cookies.some((cookie) => cookie.category !== 'necessary');
}

/**
 * Normalize `site.privacy`; `undefined` when the server doesn't send it (or sends a non-object).
 * `bannerRequired` is taken from the payload when it is a boolean and computed from the cookies
 * otherwise.
 */
export function sitePrivacy(raw: unknown): SitePrivacy | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const consent = asRecord(field(value, 'consent'));

  const cookies = records(value.cookies)
    .map(readCookie)
    .filter((cookie): cookie is PrivacyCookie => cookie !== undefined);
  const declared = field(value, 'bannerRequired');

  return {
    controller: readController(value.controller),
    processors: records(value.processors)
      .map(readProcessor)
      .filter((processor): processor is PrivacyProcessor => processor !== undefined),
    cookies,
    consent: {
      policyEntrySlug: text(consent, 'policyEntrySlug'),
      cookiePolicyEntrySlug: text(consent, 'cookiePolicyEntrySlug'),
      lastReviewed: text(consent, 'lastReviewed'),
      version: text(consent, 'version'),
    },
    bannerRequired: typeof declared === 'boolean' ? declared : cookiesNeedConsent(cookies),
  };
}

/** 32-bit FNV-1a of a string, as 8 lowercase hex digits. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The version a visitor's choice is bound to: FNV-1a over the sorted, non-necessary
 * `category|name|provider` triples (plus `consent.version`, a manual bump). Adding, removing or
 * re-categorising a cookie changes it and asks everyone again; rewording a purpose, changing a
 * duration, or moving `lastReviewed` does not.
 */
export function consentVersion(privacy: SitePrivacy | undefined): string {
  const triples = (privacy?.cookies ?? [])
    .filter((cookie) => cookie.category !== 'necessary')
    .map((cookie) => `${cookie.category}|${cookie.name}|${cookie.provider}`)
    .sort();
  const bump = privacy?.consent.version;
  return fnv1a(bump ? [...triples, `v:${bump}`].join('\n') : triples.join('\n'));
}

/** The optional categories that appear in the cookie list, in display order. */
export function consentCategories(privacy: SitePrivacy | undefined): ConsentCategory[] {
  const present = new Set((privacy?.cookies ?? []).map((cookie) => cookie.category));
  return CONSENT_CATEGORIES.filter((category) => present.has(category));
}
