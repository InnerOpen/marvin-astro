import { describe, expect, it } from 'vitest';
import { createMarvinContent } from '../src/index.js';
import { defaultResolveHref, metadataLink, socialLinkFromKey } from '../src/chrome.js';
import { createFakeClient, networkError, quietLogger } from './support/fakeClient.js';
import { footerNavigationListItems, mainNavigationListItems, marvinSite } from './support/fixtures.js';
import type { MarvinEntry } from '@inneropen/marvin-sdk';
import type { ChromeOptions } from '../src/chrome.js';
import type { FakeClientSetup } from './support/fakeClient.js';

const CONNECTION = {
  apiUrl: 'http://marvin.test',
  siteClientToken: 'site_client_test',
  workspaceSlug: 'test-workspace',
  logger: quietLogger,
};

/**
 * Nav chrome hydrates each list item, so the fake needs a full read per slug. The fixtures are
 * real list items; a full read of a nav page is the same payload plus `data`, which is what the
 * published API returns.
 */
function fullReadsFor(listItems: unknown[]): Record<string, MarvinEntry> {
  const reads: Record<string, MarvinEntry> = {};
  for (const item of listItems as MarvinEntry[]) {
    reads[item.slug] = { ...item, data: {} } as MarvinEntry;
  }
  return reads;
}

const NAV_COLLECTIONS = {
  'main-navigation': mainNavigationListItems,
  'footer-navigation': footerNavigationListItems,
};

const NAV_READS = {
  ...fullReadsFor(mainNavigationListItems),
  ...fullReadsFor(footerNavigationListItems),
};

function chromeWith(chrome: ChromeOptions = {}, setup: Partial<FakeClientSetup> = {}) {
  const fake = createFakeClient({
    collections: NAV_COLLECTIONS,
    entries: NAV_READS,
    site: marvinSite,
    ...setup,
  });
  const marvin = createMarvinContent({
    ...CONNECTION,
    createClient: () => fake.client,
    chrome,
  });
  return { marvin, fake };
}

describe('default href resolution', () => {
  it('prefixes the entry\'s own collection, which is what the workshop-reference pages need', async () => {
    const { marvin } = chromeWith();
    const chrome = await marvin.getSiteChrome();
    const terms = [...chrome.footerNavigation.flat(), ...chrome.legalLinks].find(
      (link) => link.label === 'Terms'
    );

    // `terms` belongs to workshop-reference AND footer-navigation. The old code needed an
    // eleven-slug hardcoded Set to get this right; the membership already says it.
    expect(terms?.href).toBe('/workshop-reference/terms');
  });

  it('uses a bare slug for an entry that belongs only to nav collections', async () => {
    const { marvin } = chromeWith();
    const chrome = await marvin.getSiteChrome();

    expect(chrome.mainNavigation.find((link) => link.label === 'About')?.href).toBe('/about');
  });

  it('is a pure function of the entry\'s memberships', () => {
    const href = defaultResolveHref({} as never, {
      context: 'footer',
      collectionSlug: 'footer-navigation',
      slug: 'terms',
      collections: ['footer-navigation', 'workshop-reference'],
      navCollections: new Set(['main-navigation', 'footer-navigation']),
    });

    expect(href).toBe('/workshop-reference/terms');
  });

  it('accepts an injected resolver', async () => {
    const { marvin } = chromeWith({
      resolveHref: (_entry, context) => `/docs/${context.slug}`,
    });
    const chrome = await marvin.getSiteChrome();

    expect(chrome.mainNavigation.every((link) => link.external || link.href.startsWith('/docs/'))).toBe(
      true
    );
  });
});

describe('legal split', () => {
  it('routes role="legal" footer links to the legal strip, not the columns', async () => {
    const { marvin } = chromeWith();
    const chrome = await marvin.getSiteChrome();

    expect(chrome.legalLinks.map((link) => link.label).sort()).toEqual(['Privacy', 'Terms']);
    expect(chrome.footerNavigation.flat().map((link) => link.label)).not.toContain('Terms');
  });

  it('honours a custom legal role', async () => {
    const { marvin } = chromeWith({ legalRole: 'nope' });
    const chrome = await marvin.getSiteChrome();

    expect(chrome.legalLinks).toEqual([]);
    expect(chrome.footerNavigation.flat().map((link) => link.label)).toContain('Terms');
  });

  it('uses the static legal links when the backend supplies none', async () => {
    const { marvin } = chromeWith(
      { fallback: { legalLinks: [{ label: 'Terms', href: '/terms', role: 'legal' }] } },
      { collections: { 'main-navigation': [], 'footer-navigation': [] } }
    );
    const chrome = await marvin.getSiteChrome();

    expect(chrome.legalLinks).toEqual([
      { label: 'Terms', href: '/terms', description: undefined, external: false, role: 'legal' },
    ]);
  });
});

describe('footer columns', () => {
  it('splits into two columns above the threshold', async () => {
    const { marvin } = chromeWith();
    const chrome = await marvin.getSiteChrome();

    // Six non-legal footer links in the fixture.
    expect(chrome.footerNavigation).toHaveLength(2);
    expect(chrome.footerNavigation.flat()).toHaveLength(6);
  });

  it('keeps a single column at or below the threshold', async () => {
    const { marvin } = chromeWith({ footerColumnThreshold: 10 });
    const chrome = await marvin.getSiteChrome();

    expect(chrome.footerNavigation).toHaveLength(1);
  });
});

describe('external links', () => {
  it('flags http, mailto and tel hrefs', async () => {
    const { marvin } = chromeWith();
    const chrome = await marvin.getSiteChrome();

    expect(chrome.socialLinks.find((link) => link.icon === 'email')?.external).toBe(true);
    expect(chrome.mainNavigation.every((link) => link.external === /^https?:/.test(link.href))).toBe(
      true
    );
  });
});

describe('social links', () => {
  it('derives them from the site social map and appends the contact email', async () => {
    const { marvin } = chromeWith();
    const chrome = await marvin.getSiteChrome();
    const email = chrome.socialLinks.find((link) => link.icon === 'email');

    expect(email?.href).toMatch(/^mailto:/);
    expect(email?.label).toBe('Email');
  });

  it('title-cases a social key', () => {
    expect(socialLinkFromKey('x_handle', 'https://x.com/a').label).toBe('X Handle');
  });
});

describe('offline fallback', () => {
  it('serves the static chrome when the backend is unreachable', async () => {
    const { marvin } = chromeWith(
      {
        fallback: {
          mainNavigation: [{ label: 'Home', href: '/' }],
          footerNavigation: [[{ label: 'About', href: '/about' }]],
          socialLinks: [{ label: 'Instagram', href: 'https://instagram.com/x', icon: 'instagram' }],
          inquiry: { label: 'Get in touch', href: 'mailto:hi@example.com' },
        },
      },
      { throws: networkError() }
    );
    const chrome = await marvin.getSiteChrome();

    expect(chrome.mainNavigation).toEqual([
      { label: 'Home', href: '/', description: undefined, external: false, role: undefined },
    ]);
    expect(chrome.footerNavigation).toEqual([
      [{ label: 'About', href: '/about', description: undefined, external: false, role: undefined }],
    ]);
    expect(chrome.socialLinks[0].icon).toBe('instagram');
    expect(chrome.inquiry?.href).toBe('mailto:hi@example.com');
  });

  it('memoizes, then re-resolves after reset', async () => {
    const { marvin, fake } = chromeWith();

    await marvin.getSiteChrome();
    await marvin.getSiteChrome();
    expect(fake.countOf('collections.entries:main-navigation')).toBe(1);

    marvin.reset();
    await marvin.getSiteChrome();
    expect(fake.countOf('collections.entries:main-navigation')).toBe(2);
  });
});

describe('metadataLink', () => {
  it('reads a {label, href} object out of site metadata', () => {
    expect(metadataLink({ label: 'Commission', href: '/contact', subject: 'A jacket' })).toEqual({
      label: 'Commission',
      href: '/contact',
      description: 'A jacket',
      external: false,
    });
  });

  it('returns undefined when either half is missing', () => {
    expect(metadataLink({ label: 'Commission' })).toBeUndefined();
    expect(metadataLink(null)).toBeUndefined();
  });
});
