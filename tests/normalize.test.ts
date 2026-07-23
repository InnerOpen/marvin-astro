import { describe, expect, it } from 'vitest';
import {
  assetAlt,
  assetField,
  assetUrl,
  collectionRole,
  collectionSlugs,
  entryData,
  entryField,
  entryMetadata,
  field,
  focalPoint,
  isExternalHref,
  resourceField,
  selectAssetByRole,
  selectEntryAsset,
  selectFeaturedAsset,
  selectIconAsset,
  selectImageAsset,
} from '../src/normalize.js';
import {
  asEntry,
  footerNavigationListItems,
  projectRead,
  referenceRead,
  workshopReferenceListItems,
} from './support/fixtures.js';
import type { MarvinContentEntry } from '../src/types.js';

function entryWith(overrides: Record<string, unknown>): MarvinContentEntry {
  return overrides as MarvinContentEntry;
}

describe('field precedence', () => {
  it('prefers the schema field in data_json over the legacy metadata_json value', () => {
    const entry = entryWith({
      data: { noteNumber: 'No. 12' },
      metadataJson: { noteNumber: 'No. 03' },
    });

    expect(field(entry, 'noteNumber')).toBe('No. 12');
  });

  it('falls through to metadata_json when the schema field is an empty string', () => {
    // An entry type that declares a field the author left blank stores "" — without this the
    // legacy value that IS set would never surface.
    const entry = entryWith({ data: { label: '' }, metadataJson: { label: 'Workshop' } });

    expect(field(entry, 'label')).toBe('Workshop');
  });

  it('falls through to metadata_json when the schema field is null or absent', () => {
    expect(field(entryWith({ data: { tone: null }, metadataJson: { tone: 'denim' } }), 'tone')).toBe(
      'denim'
    );
    expect(field(entryWith({ data: {}, metadataJson: { tone: 'olive' } }), 'tone')).toBe('olive');
  });

  it('treats an empty metadata_json value as absent rather than returning ""', () => {
    expect(field(entryWith({ data: {}, metadataJson: { label: '' } }), 'label')).toBeUndefined();
  });

  it('reads through the SDK Entry accessor when given a wrapped entry', () => {
    const entry = asEntry(referenceRead);

    expect(entryField<string>(entry, 'body')).toContain('Do You Release Collections?');
    expect(field<string>(entry, 'body')).toBe(entryField<string>(entry, 'body'));
  });

  it('returns undefined for schema fields on an unhydrated list item', () => {
    // PublishedEntryListItem omits data_json entirely — this is why `hydrate` exists.
    const listItem = workshopReferenceListItems[0];

    expect(entryData(listItem)).toEqual({});
    expect(entryField(listItem, 'body')).toBeUndefined();
  });
});

describe('entryMetadata', () => {
  it('reads metadataJson and tolerates null', () => {
    expect(entryMetadata(entryWith({ metadataJson: { order: 5 } }))).toEqual({ order: 5 });
    expect(entryMetadata(entryWith({ metadataJson: null }))).toEqual({});
  });
});

describe('collection membership', () => {
  it('reads slugs from the nested {collection: {slug}} shape', () => {
    const terms = footerNavigationListItems.find((entry) => entry.slug === 'terms')!;

    expect(collectionSlugs(terms)).toEqual(
      expect.arrayContaining(['workshop-reference', 'footer-navigation'])
    );
  });

  it('reads slugs from a bare string list and a flat {slug} list', () => {
    expect(collectionSlugs(entryWith({ collections: ['projects', 'featured'] }))).toEqual([
      'projects',
      'featured',
    ]);
    expect(collectionSlugs(entryWith({ collections: [{ slug: 'projects' }] }))).toEqual(['projects']);
  });

  it('finds the membership role for one specific collection', () => {
    const terms = footerNavigationListItems.find((entry) => entry.slug === 'terms')!;
    const about = footerNavigationListItems.find((entry) => entry.slug === 'about')!;

    expect(collectionRole(terms, 'footer-navigation')).toBe('legal');
    expect(collectionRole(terms, 'workshop-reference')).toBeUndefined();
    expect(collectionRole(about, 'footer-navigation')).toBeUndefined();
  });
});

describe('focalPoint', () => {
  it('passes a pre-formatted string through', () => {
    expect(focalPoint('40% 65%')).toBe('40% 65%');
  });

  it('converts {x, y} in 0-1 units to percentages', () => {
    expect(focalPoint({ x: 0.4, y: 0.65 })).toBe('40% 65%');
  });

  it('leaves {x, y} already in 0-100 units alone', () => {
    expect(focalPoint({ x: 40, y: 65 })).toBe('40% 65%');
  });

  it('returns undefined for a partial or missing point', () => {
    expect(focalPoint({ x: 0.4 })).toBeUndefined();
    expect(focalPoint(undefined)).toBeUndefined();
    expect(focalPoint('')).toBeUndefined();
  });
});

describe('assetField', () => {
  it('reads the placement level before the nested asset', () => {
    const placement = { role: 'hero', asset: { role: 'support', publicUrl: '/a.jpg' } };

    expect(assetField(placement, 'role')).toBe('hero');
    expect(assetUrl(placement)).toBe('/a.jpg');
  });

  it('reads through placement metadata blobs', () => {
    expect(assetField({ placementMetadata: { focalPoint: '10% 20%' } }, 'focalPoint')).toBe(
      '10% 20%'
    );
    expect(assetField({ asset: { metadataJson: { credit: 'AB' } } }, 'credit')).toBe('AB');
  });

  it('falls back to the supplied alt when the asset carries none', () => {
    expect(assetAlt({ asset: { altText: null } }, 'Project photo')).toBe('Project photo');
    expect(assetAlt({ asset: { altText: 'Sleeve detail' } }, 'Project photo')).toBe('Sleeve detail');
  });

  it('returns undefined for non-object input', () => {
    expect(assetField(null, 'role')).toBeUndefined();
    expect(assetField('nope', 'role')).toBeUndefined();
  });
});

describe('resourceField', () => {
  it('reads the resource through the relationship wrapper', () => {
    const relationship = projectRead.resources![0] as unknown;

    expect(resourceField(relationship, 'role')).toBe('primary-material');
    expect(resourceField(relationship, 'resourceType')).toBe('material');
    expect(resourceField(relationship, 'name')).toBe('Herringbone Twill');
  });
});

describe('asset selection', () => {
  const heroPlacement = { role: 'hero', asset: { assetType: 'image', publicUrl: '/hero.jpg' } };
  const usagePlacement = { usage: 'card', asset: { assetType: 'image', publicUrl: '/card.jpg' } };
  const unroled = { asset: { assetType: 'image', publicUrl: '/loose.jpg' } };
  const iconPlacement = {
    role: 'icon',
    asset: { assetType: 'svg', mimeType: 'image/svg+xml', publicUrl: '/icon.svg' },
  };

  it('matches by role when both role and usage criteria are given', () => {
    const entry = entryWith({ assets: [usagePlacement, heroPlacement] });

    expect(assetUrl(selectEntryAsset(entry, { roles: ['hero'], usages: ['hero'] }))).toBe(
      '/hero.jpg'
    );
  });

  it('treats usage as an alternative to role, not a second requirement', () => {
    const entry = entryWith({ assets: [usagePlacement] });

    expect(assetUrl(selectEntryAsset(entry, { roles: ['hero'], usages: ['card'] }))).toBe(
      '/card.jpg'
    );
  });

  it('degenerates to "the first asset" when only roles are given', () => {
    // Role and usage are ORed, and an absent usage criterion is vacuously true — so a role-only
    // query matches everything. This is the trap `selectAssetByRole` exists to avoid; pin it so
    // nobody "fixes" the OR without realising what depends on it.
    const entry = entryWith({ assets: [usagePlacement, heroPlacement] });

    expect(assetUrl(selectEntryAsset(entry, { roles: ['hero'] }))).toBe('/card.jpg');
  });

  it('only accepts an unroled asset when allowUnroled is set', () => {
    const entry = entryWith({ assets: [unroled] });

    expect(selectEntryAsset(entry, { roles: ['hero'], usages: ['hero'] })).toBeUndefined();
    expect(
      assetUrl(selectEntryAsset(entry, { roles: ['hero'], usages: ['hero'], allowUnroled: true }))
    ).toBe('/loose.jpg');
  });

  it('filters by asset type', () => {
    const entry = entryWith({ assets: [iconPlacement, heroPlacement] });

    expect(assetUrl(selectEntryAsset(entry, { types: ['image'] }))).toBe('/hero.jpg');
    expect(assetUrl(selectEntryAsset(entry, { types: ['svg'] }))).toBe('/icon.svg');
  });

  it('selectAssetByRole matches the role EXACTLY, unlike selectEntryAsset', () => {
    const entry = entryWith({ assets: [iconPlacement, heroPlacement] });

    // selectEntryAsset ORs role against a vacuously-true usage check, so it returns the first
    // asset here — the icon — even though the requested role is `hero-grade`.
    expect(assetUrl(selectEntryAsset(entry, { roles: ['hero-grade'] }))).toBe('/icon.svg');
    expect(selectAssetByRole(entry, 'hero-grade')).toBeUndefined();
    expect(assetUrl(selectAssetByRole(entry, 'hero'))).toBe('/hero.jpg');
  });

  it('selectAssetByRole honours role preference order', () => {
    const graded = { role: 'hero-grade', asset: { publicUrl: '/graded.jpg' } };
    const entry = entryWith({ assets: [heroPlacement, graded] });

    expect(assetUrl(selectAssetByRole(entry, 'hero-grade', 'hero'))).toBe('/graded.jpg');
    expect(assetUrl(selectAssetByRole(entry, 'missing', 'hero'))).toBe('/hero.jpg');
  });

  it('selectIconAsset prefers the SVG icon', () => {
    const entry = entryWith({ assets: [iconPlacement] });

    expect(assetUrl(selectIconAsset(entry))).toBe('/icon.svg');
  });

  it('selectImageAsset finds a real support asset on the live project fixture', () => {
    const asset = selectImageAsset(projectRead, {
      roles: ['support'],
      usages: ['support'],
    });

    expect(assetUrl(asset)).toMatch(/^https?:\/\//);
  });

  it('selectFeaturedAsset reads the list item shorthand', () => {
    const listItem = workshopReferenceListItems.find((entry) => entry.slug === 'faq')!;

    expect(assetUrl(selectFeaturedAsset(listItem))).toContain('envelope.svg');
    expect(selectFeaturedAsset(entryWith({}))).toBeUndefined();
  });
});

describe('isExternalHref', () => {
  it.each([
    ['https://example.com', true],
    ['http://example.com', true],
    ['mailto:hi@example.com', true],
    ['tel:+15550000000', true],
    ['/about', false],
    ['#anchor', false],
  ])('%s → %s', (href, expected) => {
    expect(isExternalHref(href)).toBe(expected);
  });
});
