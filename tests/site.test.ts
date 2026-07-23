import { describe, expect, it } from 'vitest';
import { buildFallbackSite, buildSeo } from '../src/site.js';
import { createMarvinContent } from '../src/index.js';
import { createFakeClient, networkError, quietLogger } from './support/fakeClient.js';
import { fakeAsset, marvinSite } from './support/fixtures.js';
import type { MarvinSite } from '@inneropen/marvin-sdk';

const CONNECTION = {
  apiUrl: 'http://marvin.test',
  siteClientToken: 'site_client_test',
  workspaceSlug: 'test-workspace',
  logger: quietLogger,
};

const STATIC_SITE = {
  name: 'Static Workshop',
  description: 'A static description',
  tagline: 'Static tagline',
  email: 'static@example.com',
  social: { instagram: 'https://instagram.com/static' },
};

const BRAND_ASSETS = {
  'mb-monogram': fakeAsset('mb-monogram', 'https://cdn.test/monogram.svg'),
  'mb-favicon': fakeAsset('mb-favicon', 'https://cdn.test/favicon.png'),
  'maker-stamp-round': fakeAsset('maker-stamp-round', 'https://cdn.test/seal.svg'),
};

function siteWith(site: MarvinSite | null, options: Record<string, unknown> = {}) {
  const fake = createFakeClient({ site, assets: BRAND_ASSETS });
  const marvin = createMarvinContent({
    ...CONNECTION,
    createClient: () => fake.client,
    site: { fallback: STATIC_SITE },
    ...options,
  });
  return { marvin, fake };
}

describe('buildSeo identity fallbacks', () => {
  it('never leaves title, description or siteName empty', () => {
    const seo = buildSeo(undefined, {
      title: 'Workshop',
      description: 'Things made well',
      siteName: 'Workshop',
    });

    expect(seo.title).toBe('Workshop');
    expect(seo.description).toBe('Things made well');
    expect(seo.siteName).toBe('Workshop');
  });

  it('applies neutral defaults for robots, og type and twitter card', () => {
    const seo = buildSeo({}, { title: 'W', description: 'D', siteName: 'W' });

    expect(seo.robots).toBe('index,follow');
    expect(seo.ogType).toBe('website');
    expect(seo.twitterCard).toBe('summary_large_image');
    expect(seo.keywords).toEqual([]);
    expect(seo.verification).toEqual({
      google: undefined,
      bing: undefined,
      pinterest: undefined,
      yandex: undefined,
    });
  });

  it('treats an explicitly empty SEO title as absent', () => {
    const seo = buildSeo({ title: '   ' }, { title: 'W', description: 'D', siteName: 'W' });

    expect(seo.title).toBe('W');
  });

  it('drops non-string keywords', () => {
    const seo = buildSeo(
      { keywords: ['denim', 42, null] },
      { title: 'W', description: 'D', siteName: 'W' }
    );

    expect(seo.keywords).toEqual(['denim']);
  });
});

describe('buildFallbackSite', () => {
  it('fills locale, timezone, social and metadata with neutral defaults', () => {
    const site = buildFallbackSite({ fallback: { name: 'Workshop' } });

    expect(site).toMatchObject({
      name: 'Workshop',
      title: 'Workshop',
      description: '',
      locale: 'en-US',
      timezone: 'UTC',
      social: {},
      metadata: {},
    });
    expect(site.seo.siteName).toBe('Workshop');
  });

  it('works with no fallback at all', () => {
    const site = buildFallbackSite();

    expect(site.title).toBe('Untitled site');
    expect(site.seo.title).toBe('Untitled site');
  });

  it('accepts a fallback factory', () => {
    expect(buildFallbackSite({ fallback: () => ({ name: 'Lazy' }) }).name).toBe('Lazy');
  });
});

describe('getSite', () => {
  it('resolves identity, SEO and social from the live site payload', async () => {
    const { marvin } = siteWith(marvinSite);
    const site = await marvin.getSite();

    expect(site.title).toBe('Mash & Burn Co.');
    expect(site.workspaceSlug).toBe('mash-burn-co');
    expect(site.locale).toBe('en-US');
    expect(site.timezone).toBe('America/New_York');
    expect(site.email).toBe('hello@mashandburnco.com');
    expect(site.seo.titleTemplate).toBe('%s | Mash & Burn Co.');
    expect(site.seo.canonicalUrl).toBe('https://mashandburnco.com');
    expect(site.seo.verification.pinterest).toBe('demo-pinterest-token');
    expect(site.social.instagram).toContain('instagram.com');
  });

  it('resolves every brand slug to a URL in one pass', async () => {
    const { marvin } = siteWith(marvinSite);
    const site = await marvin.getSite();

    expect(site.brand?.logo).toBe('https://cdn.test/monogram.svg');
    expect(site.brand?.seal).toBe('https://cdn.test/seal.svg');
    // Aliases for the common three.
    expect(site.logo).toBe('https://cdn.test/monogram.svg');
    expect(site.favicon).toBe('https://cdn.test/favicon.png');
    expect(site.seal).toBe('https://cdn.test/seal.svg');
    // Slugs that resolve to nothing are dropped, not stored as undefined.
    expect(Object.values(site.brand ?? {}).every(Boolean)).toBe(true);
  });

  it('resolves an og:image given as a bare asset slug', async () => {
    const { marvin } = siteWith(marvinSite);
    const site = await marvin.getSite();

    expect(site.seo.image).toBe('https://cdn.test/monogram.svg');
  });

  it('leaves an og:image that is already a URL or path alone', async () => {
    const withUrlImage = {
      ...marvinSite,
      site: {
        ...marvinSite.site,
        seo: { ...(marvinSite.site as { seo?: object }).seo, image: '/og/default.png' },
      },
    } as MarvinSite;
    const { marvin } = siteWith(withUrlImage);

    expect((await marvin.getSite()).seo.image).toBe('/og/default.png');
  });

  it('falls back to static identity when the backend is unreachable', async () => {
    const fake = createFakeClient({ throws: networkError() });
    const marvin = createMarvinContent({
      ...CONNECTION,
      createClient: () => fake.client,
      site: { fallback: STATIC_SITE },
    });
    const site = await marvin.getSite();

    expect(site.name).toBe('Static Workshop');
    expect(site.seo.description).toBe('A static description');
    expect(site.social.instagram).toBe('https://instagram.com/static');
  });

  it('fills gaps in the Marvin payload from the static fallback, field by field', async () => {
    const sparse = {
      workspace: { slug: 'ws', name: 'WS' },
      site: { title: 'Live title', locale: 'en-US', timezone: 'UTC', metadataJson: {} },
    } as unknown as MarvinSite;
    const { marvin } = siteWith(sparse);
    const site = await marvin.getSite();

    expect(site.title).toBe('Live title');
    expect(site.description).toBe('A static description');
    expect(site.tagline).toBe('Static tagline');
    expect(site.email).toBe('static@example.com');
    // Static social survives alongside anything the backend adds.
    expect(site.social.instagram).toBe('https://instagram.com/static');
  });

  it('memoizes so brand resolution happens once per process', async () => {
    const { marvin, fake } = siteWith(marvinSite);

    await Promise.all([marvin.getSite(), marvin.getSite()]);
    await marvin.getSite();

    expect(fake.countOf('getSite')).toBe(1);
    expect(fake.countOf('assets.get:mb-monogram')).toBe(1);

    marvin.reset();
    await marvin.getSite();
    expect(fake.countOf('getSite')).toBe(2);
  });
});
