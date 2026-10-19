/**
 * Neutral English defaults for the privacy and consent components. Every string can be replaced
 * per site through the components' `labels` props; Marvin-editable text is a later step.
 */
import type { CookieCategory } from '../privacy.js';

/** Default consent lifetime, ~6 months. Refusals last as long as acceptances. */
export const DEFAULT_MAX_AGE_DAYS = 180;

/** The storage key the consent runtime writes; disclosed as a necessary entry. */
export const CONSENT_STORAGE_KEY = 'marvin-consent';

export const CATEGORY_LABELS: Record<CookieCategory, string> = {
  necessary: 'Necessary',
  preferences: 'Preferences',
  analytics: 'Analytics',
  marketing: 'Marketing',
};

export const CATEGORY_DESCRIPTIONS: Record<CookieCategory, string> = {
  necessary: 'Needed for the site to work, or to remember a choice you made. Always on.',
  preferences: 'Remember settings such as your language or theme.',
  analytics: 'Help us understand how the site is used so we can improve it.',
  marketing: 'Used to show relevant content or measure campaigns.',
};

export type PrivacyLabels = {
  // Tables
  cookieName: string;
  provider: string;
  purpose: string;
  duration: string;
  processor: string;
  data: string;
  region: string;
  transferBasis: string;
  links: string;
  dpa: string;
  privacyPolicy: string;
  thisSite: string;
  consentCookiePurpose: string;
  noscript: string;
  // Policy page
  controller: string;
  legalName: string;
  address: string;
  contact: string;
  euRepresentative: string;
  dpo: string;
  processors: string;
  cookies: string;
  lastReviewed: string;
  changeSettings: string;
  categories: Record<CookieCategory, string>;
};

export const DEFAULT_PRIVACY_LABELS: PrivacyLabels = {
  cookieName: 'Name',
  provider: 'Provider',
  purpose: 'Purpose',
  duration: 'Duration',
  processor: 'Processor',
  data: 'Data',
  region: 'Region',
  transferBasis: 'Transfer basis',
  links: 'Links',
  dpa: 'Data processing agreement',
  privacyPolicy: 'Privacy policy',
  thisSite: 'This site',
  consentCookiePurpose: 'Remembers your cookie choices.',
  noscript: 'Optional cookies are off because JavaScript is disabled.',
  controller: 'Who is responsible for your data',
  legalName: 'Controller',
  address: 'Address',
  contact: 'Contact',
  euRepresentative: 'EU representative',
  dpo: 'Data protection officer',
  processors: 'Who else handles your data',
  cookies: 'Cookies and similar storage',
  lastReviewed: 'Last reviewed',
  changeSettings: 'Change your cookie settings',
  categories: CATEGORY_LABELS,
};

/** `labels` merged over the defaults (one level deep, plus `categories`). */
export function privacyLabels(overrides?: Partial<Omit<PrivacyLabels, 'categories'>> & {
  categories?: Partial<Record<CookieCategory, string>>;
}): PrivacyLabels {
  return {
    ...DEFAULT_PRIVACY_LABELS,
    ...overrides,
    categories: { ...CATEGORY_LABELS, ...overrides?.categories },
  };
}

/** 180 → "6 months", 365 → "12 months", 30 → "30 days". */
export function formatMaxAge(days: number): string {
  if (days >= 60) return `${Math.round(days / 30)} months`;
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
