import { describe, expect, it } from 'vitest';
import { createMarvinContent } from '../src/index.js';
import { createFakeClient, networkError, quietLogger } from './support/fakeClient.js';
import {
  footerNavigationListItems,
  projectRead,
  referenceRead,
  workshopReferenceListItems,
} from './support/fixtures.js';
import type { FakeClientSetup } from './support/fakeClient.js';

type Reference = {
  slug: string;
  title: string;
  order: number;
  body?: string;
  featured?: boolean;
  href?: string;
};

const CONNECTION = {
  apiUrl: 'http://marvin.test',
  siteClientToken: 'site_client_test',
  workspaceSlug: 'test-workspace',
  logger: quietLogger,
};

function contentWith(setup: FakeClientSetup, overrides: Record<string, unknown> = {}) {
  const fake = createFakeClient(setup);
  const marvin = createMarvinContent({
    ...CONNECTION,
    createClient: () => fake.client,
    ...overrides,
  });
  return { marvin, fake };
}

/** The fixture's full reads, keyed by slug, so hydration has something to hydrate to. */
const FULL_READS = {
  [referenceRead.slug]: referenceRead,
  [projectRead.slug]: projectRead,
};

const STATIC_REFERENCES: Reference[] = [
  { slug: 'sizing', title: 'Sizing (static)', order: 1 },
  { slug: 'care-guide', title: 'Care guide (static)', order: 2, featured: true },
];

describe('repository: source selection', () => {
  it('loads from Marvin when the backend is up', async () => {
    const { marvin } = contentWith({
      collections: { 'workshop-reference': workshopReferenceListItems },
    });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      fallback: () => STATIC_REFERENCES,
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    const all = await references.all();

    expect(all.length).toBe(workshopReferenceListItems.length);
    expect(all.map((item) => item.slug)).toContain('faq');
  });

  it('falls back to static data when Marvin is not configured', async () => {
    const marvin = createMarvinContent({ env: {}, logger: quietLogger });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      fallback: () => STATIC_REFERENCES,
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    expect(await references.all()).toEqual(STATIC_REFERENCES);
  });

  it('falls back to static data when the backend is unreachable', async () => {
    const { marvin } = contentWith({ throws: networkError() });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      fallback: () => STATIC_REFERENCES,
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    expect(await references.all()).toEqual(STATIC_REFERENCES);
  });

  it('falls back to static data when the collection exists but is empty', async () => {
    const { marvin } = contentWith({ collections: { 'workshop-reference': [] } });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      fallback: () => STATIC_REFERENCES,
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    expect(await references.all()).toEqual(STATIC_REFERENCES);
  });

  it('returns an empty list when there is neither backend nor fallback', async () => {
    const marvin = createMarvinContent({ env: {}, logger: quietLogger });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    expect(await references.all()).toEqual([]);
  });

  it('survives a transform that throws, by falling back', async () => {
    const { marvin } = contentWith({
      collections: { 'workshop-reference': workshopReferenceListItems },
    });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      fallback: () => STATIC_REFERENCES,
      transform: () => {
        throw new Error('bad transform');
      },
    });

    expect(await references.all()).toEqual(STATIC_REFERENCES);
  });
});

describe('repository: collection-name fallback order', () => {
  it('uses the first collection that yields entries', async () => {
    const { marvin, fake } = contentWith({
      collections: {
        'bench-notes': [],
        journal: workshopReferenceListItems,
        blog: workshopReferenceListItems,
      },
    });
    const posts = marvin.repository<Reference>({
      collections: ['bench-notes', 'journal', 'blog'],
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    expect((await posts.all()).length).toBe(workshopReferenceListItems.length);
    expect(fake.calls).toContain('collections.entries:bench-notes');
    expect(fake.calls).toContain('collections.entries:journal');
    // Stops as soon as one produces entries.
    expect(fake.calls).not.toContain('collections.entries:blog');
  });
});

describe('repository: hydration', () => {
  it('does NOT fetch entries when hydrate is off, so schema fields are unreadable', async () => {
    const { marvin, fake } = contentWith({
      collections: { 'workshop-reference': workshopReferenceListItems },
      entries: FULL_READS,
    });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      transform: (entry, f) => ({
        slug: entry.slug ?? '',
        title: entry.title ?? '',
        order: 0,
        body: f.string('body'),
      }),
    });

    const faq = (await references.all()).find((item) => item.slug === 'faq');

    expect(faq?.body).toBeUndefined();
    expect(fake.countOf('entry:')).toBe(0);
  });

  it('fetches each list item as a full entry when hydrate is on', async () => {
    const { marvin, fake } = contentWith({
      collections: { 'workshop-reference': workshopReferenceListItems },
      entries: FULL_READS,
    });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      hydrate: true,
      transform: (entry, f) => ({
        slug: entry.slug ?? '',
        title: entry.title ?? '',
        order: 0,
        body: f.string('body'),
      }),
    });

    const all = await references.all();
    const faq = all.find((item) => item.slug === 'faq');

    expect(faq?.body).toContain('Do You Release Collections?');
    expect(fake.countOf('entry:')).toBe(workshopReferenceListItems.length);
    // Entries with no full read available drop out rather than becoming empty items.
    expect(all.length).toBe(1);
  });

  it('passes entries that already carry data through without a second fetch', async () => {
    const { marvin, fake } = contentWith({
      collections: { projects: [projectRead] },
      entries: FULL_READS,
    });
    const projects = marvin.repository<Reference>({
      collection: 'projects',
      hydrate: true,
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    expect((await projects.all()).length).toBe(1);
    expect(fake.countOf('entry:')).toBe(0);
  });
});

describe('repository: filter and sort', () => {
  it('sorts Marvin results', async () => {
    const { marvin } = contentWith({
      collections: { 'workshop-reference': workshopReferenceListItems },
    });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      sort: (a, b) => a.title.localeCompare(b.title),
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    const titles = (await references.all()).map((item) => item.title);

    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
  });

  it('applies the same sort and filter to fallback data, so order does not depend on source', async () => {
    const marvin = createMarvinContent({ env: {}, logger: quietLogger });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      fallback: () => STATIC_REFERENCES,
      filter: (item) => item.order > 1,
      sort: (a, b) => b.order - a.order,
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    expect((await references.all()).map((item) => item.slug)).toEqual(['care-guide']);
  });
});

describe('repository: bySlug', () => {
  it('fetches the entry directly rather than scanning the list', async () => {
    const { marvin, fake } = contentWith({
      collections: { 'workshop-reference': workshopReferenceListItems },
      entries: FULL_READS,
    });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      transform: (entry, f) => ({
        slug: entry.slug ?? '',
        title: entry.title ?? '',
        order: 0,
        body: f.string('body'),
      }),
    });

    const faq = await references.bySlug('faq');

    expect(faq?.body).toContain('Do You Release Collections?');
    expect(fake.countOf('collections.entries')).toBe(0);
  });

  it('falls back to a scan of all() when the entry is not in Marvin', async () => {
    const { marvin } = contentWith({
      collections: { 'workshop-reference': workshopReferenceListItems },
      entries: {},
    });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    expect((await references.bySlug('faq'))?.title).toBe('FAQ');
    expect(await references.bySlug('does-not-exist')).toBeUndefined();
  });

  it('finds items in static data when there is no backend', async () => {
    const marvin = createMarvinContent({ env: {}, logger: quietLogger });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      fallback: () => STATIC_REFERENCES,
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    expect((await references.bySlug('sizing'))?.title).toBe('Sizing (static)');
  });
});

describe('repository: featured', () => {
  it('returns the first featured item, and the first item when none is marked', async () => {
    const marvin = createMarvinContent({ env: {}, logger: quietLogger });
    const featuredRepo = marvin.repository<Reference>({
      fallback: () => STATIC_REFERENCES,
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });
    const unmarkedRepo = marvin.repository<Reference>({
      fallback: () => STATIC_REFERENCES.map((item) => ({ ...item, featured: false })),
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    expect((await featuredRepo.featured())?.slug).toBe('care-guide');
    expect(await featuredRepo.allFeatured()).toHaveLength(1);
    expect((await unmarkedRepo.featured())?.slug).toBe('sizing');
  });

  it('honours a custom isFeatured predicate', async () => {
    const marvin = createMarvinContent({ env: {}, logger: quietLogger });
    const references = marvin.repository<Reference>({
      fallback: () => STATIC_REFERENCES,
      isFeatured: (item) => item.order === 1,
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    expect((await references.featured())?.slug).toBe('sizing');
  });
});

describe('repository: memoization', () => {
  it('resolves the collection once per process', async () => {
    const { marvin, fake } = contentWith({
      collections: { 'workshop-reference': workshopReferenceListItems },
    });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    await Promise.all([references.all(), references.all()]);
    await references.all();

    expect(fake.countOf('collections.entries')).toBe(1);
  });

  it('caches bySlug per slug', async () => {
    const { marvin, fake } = contentWith({
      collections: { 'workshop-reference': workshopReferenceListItems },
      entries: FULL_READS,
    });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    await references.bySlug('faq');
    await references.bySlug('faq');

    expect(fake.countOf('entry:faq')).toBe(1);
  });

  it('reset() drops both caches', async () => {
    const { marvin, fake } = contentWith({
      collections: { 'workshop-reference': workshopReferenceListItems },
      entries: FULL_READS,
    });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    await references.all();
    await references.bySlug('faq');
    references.reset();
    await references.all();
    await references.bySlug('faq');

    expect(fake.countOf('collections.entries')).toBe(2);
    expect(fake.countOf('entry:faq')).toBe(2);
  });

  it('marvin.reset() resets every repository it created', async () => {
    const { marvin, fake } = contentWith({
      collections: { 'workshop-reference': workshopReferenceListItems },
    });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    await references.all();
    marvin.reset();
    await references.all();

    expect(fake.countOf('collections.entries')).toBe(2);
  });
});

describe('repository: href', () => {
  it('exposes the resolved route to the transform', async () => {
    const { marvin } = contentWith({
      collections: { 'workshop-reference': workshopReferenceListItems },
    });
    const references = marvin.repository<Reference>({
      collection: 'workshop-reference',
      href: (slug) => `/workshop-reference/${slug}`,
      transform: (entry, f) => ({
        slug: entry.slug ?? '',
        title: entry.title ?? '',
        order: 0,
        href: f.href,
      }),
    });

    const faq = (await references.all()).find((item) => item.slug === 'faq');

    expect(faq?.href).toBe('/workshop-reference/faq');
  });
});

describe('repository: entries with no full read', () => {
  it('drops list items that cannot be hydrated instead of emitting blanks', async () => {
    const { marvin } = contentWith({
      collections: { 'footer-navigation': footerNavigationListItems },
      entries: {},
    });
    const links = marvin.repository<Reference>({
      collection: 'footer-navigation',
      hydrate: true,
      transform: (entry) => ({ slug: entry.slug ?? '', title: entry.title ?? '', order: 0 }),
    });

    expect(await links.all()).toEqual([]);
  });
});
