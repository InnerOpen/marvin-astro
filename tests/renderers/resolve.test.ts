import { describe, it, expect } from 'vitest';
import type { EntryTypeInfo, RendererEntry } from '../../src/renderers/types.js';
import {
  resolveRendererName,
  resolveRendererRequirement,
  resolveRendererConfig,
  extractBody,
  extractField,
  getFeaturedAsset,
  isRoutable,
  shouldRenderEntry,
} from '../../src/renderers/resolve.js';

/**
 * A minimally-valid published entry — renderers only ever receive this shape. Asserted rather than
 * annotated: SDK 4 adds required fields (`tags`) that SDK 3 doesn't know, and both are supported.
 */
function makeEntry(overrides: Partial<RendererEntry> = {}): RendererEntry {
  return {
    title: 'Test Entry',
    slug: 'test-entry',
    entryType: 'page',
    data: {},
    collections: [],
    resources: [],
    assets: [],
    tags: [],
    ...overrides,
  } as RendererEntry;
}

/** entryTypeInfo fixture — fills the required flags so tests can vary only what they assert on. */
function entryTypeInfo(overrides: Partial<EntryTypeInfo> & { slug: string }): EntryTypeInfo {
  return { publishable: true, submittable: false, routable: true, ...overrides };
}

describe('resolveRendererName', () => {
  it('returns renderer from entryTypeInfo', () => {
    const entry = makeEntry({
      entryTypeInfo: entryTypeInfo({ slug: 'article', renderer: 'article' }),
    });
    expect(resolveRendererName(entry)).toBe('article');
  });

  it('falls back to "page" when no entryTypeInfo', () => {
    expect(resolveRendererName(makeEntry())).toBe('page');
  });

  it('falls back to "page" when renderer is undefined', () => {
    const entry = makeEntry({
      entryTypeInfo: entryTypeInfo({ slug: 'custom' }),
    });
    expect(resolveRendererName(entry)).toBe('page');
  });
});

describe('resolveRendererRequirement', () => {
  it('returns the renderer requirement from entryTypeInfo', () => {
    const entry = makeEntry({
      entryTypeInfo: entryTypeInfo({ slug: 'faq', renderer: 'faq', package: '@inneropen/marvin-renderers-core', version: '^1.0.0', config: { layout: 'stacked' } }),
    });

    expect(resolveRendererRequirement(entry)).toEqual({
      key: 'faq',
      packageName: '@inneropen/marvin-renderers-core',
      versionRange: '^1.0.0',
      config: { layout: 'stacked' },
    });
  });
});

describe('resolveRendererConfig', () => {
  it('returns entryTypeInfo config when no overrides', () => {
    const entry = makeEntry({
      entryTypeInfo: entryTypeInfo({ slug: 'page', config: { layout: 'wide' } }),
    });
    expect(resolveRendererConfig(entry)).toEqual({ layout: 'wide' });
  });

  it('returns empty object when no config and no overrides', () => {
    expect(resolveRendererConfig(makeEntry())).toEqual({});
  });

  it('merges overrides on top of entry config', () => {
    const entry = makeEntry({
      entryTypeInfo: entryTypeInfo({ slug: 'page', config: { layout: 'wide', sidebar: true } }),
    });
    const result = resolveRendererConfig(entry, { layout: 'narrow', toc: true });
    expect(result).toEqual({ layout: 'narrow', sidebar: true, toc: true });
  });
});

describe('extractBody', () => {
  it('returns body from dataJson', () => {
    const entry = makeEntry({ dataJson: { body: '<p>Hello</p>' } });
    expect(extractBody(entry)).toBe('<p>Hello</p>');
  });

  it('falls back to contentMarkdown', () => {
    const entry = makeEntry({ contentMarkdown: '# Hello' });
    expect(extractBody(entry)).toBe('# Hello');
  });

  it('prefers dataJson.body over contentMarkdown', () => {
    const entry = makeEntry({
      dataJson: { body: '<p>From data</p>' },
      contentMarkdown: '# From markdown',
    });
    expect(extractBody(entry)).toBe('<p>From data</p>');
  });

  it('returns undefined when neither exists', () => {
    expect(extractBody(makeEntry())).toBeUndefined();
  });

  it('falls back to contentMarkdown when body is not a string', () => {
    const entry = makeEntry({
      dataJson: { body: 42 },
      contentMarkdown: '# Fallback',
    });
    expect(extractBody(entry)).toBe('# Fallback');
  });
});

describe('extractField', () => {
  it('extracts a typed field from dataJson', () => {
    const entry = makeEntry({ dataJson: { question: 'Why?' } });
    expect(extractField<string>(entry, 'question')).toBe('Why?');
  });

  it('returns undefined for missing field', () => {
    const entry = makeEntry({ dataJson: {} });
    expect(extractField(entry, 'missing')).toBeUndefined();
  });

  it('returns undefined when no dataJson', () => {
    expect(extractField(makeEntry(), 'anything')).toBeUndefined();
  });
});

/**
 * `getFeaturedAsset` deliberately tolerates two asset shapes: the canonical
 * PublishedEntryAsset junction (`{ role, position, asset }`) and a legacy flat asset
 * carrying `metadata.role`. The fixtures below exercise the legacy flat form, so they
 * are cast to the declared array type rather than pretending to be canonical.
 */
function asLegacyEntryAssets(assets: unknown[]): RendererEntry['assets'] {
  return assets as RendererEntry['assets'];
}

/** The resolver passes the matched object straight through, so read `id` off the fixture. */
function idOf(asset: unknown): string | undefined {
  return (asset as { id?: string } | undefined)?.id;
}

describe('getFeaturedAsset', () => {
  const imgAsset = {
    id: 'a1',
    slug: 'photo',
    name: 'Photo',
    originalFilename: 'photo.jpg',
    filename: 'photo.jpg',
    extension: 'jpg',
    mimeType: 'image/jpeg',
    assetType: 'image' as const,
    fileSize: 1024,
    checksum: 'abc',
    storageProvider: 's3',
    storageKey: 'photos/photo.jpg',
    publicUrl: 'https://cdn.example.com/photo.jpg',
    uploadedBy: 'user-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('returns asset with role "featured"', () => {
    const featured = { ...imgAsset, id: 'a2', metadata: { role: 'featured' } };
    const entry = makeEntry({ assets: asLegacyEntryAssets([imgAsset, featured]) });
    expect(idOf(getFeaturedAsset(entry))).toBe('a2');
  });

  it('returns asset with role "hero"', () => {
    const hero = { ...imgAsset, id: 'a3', metadata: { role: 'hero' } };
    const entry = makeEntry({ assets: asLegacyEntryAssets([imgAsset, hero]) });
    expect(idOf(getFeaturedAsset(entry))).toBe('a3');
  });

  it('falls back to first asset when no role matches', () => {
    const entry = makeEntry({ assets: asLegacyEntryAssets([imgAsset]) });
    expect(idOf(getFeaturedAsset(entry))).toBe('a1');
  });

  it('returns undefined when no assets', () => {
    expect(getFeaturedAsset(makeEntry())).toBeUndefined();
    expect(getFeaturedAsset(makeEntry({ assets: [] }))).toBeUndefined();
  });
});

describe('isRoutable', () => {
  it('returns true by default', () => {
    expect(isRoutable(makeEntry())).toBe(true);
  });

  it('returns true when routable is true', () => {
    const entry = makeEntry({
      entryTypeInfo: entryTypeInfo({ slug: 'page', routable: true }),
    });
    expect(isRoutable(entry)).toBe(true);
  });

  it('returns false when routable is false', () => {
    const entry = makeEntry({
      entryTypeInfo: entryTypeInfo({ slug: 'nav', routable: false }),
    });
    expect(isRoutable(entry)).toBe(false);
  });
});

describe('shouldRenderEntry', () => {
  it('returns false when the renderer-specific flag is false', () => {
    const entry = makeEntry({ dataJson: { faq: false } });
    expect(shouldRenderEntry(entry, 'faq')).toBe(false);
  });

  it('returns false when a generic enabled flag is false', () => {
    const entry = makeEntry({ dataJson: { enabled: false } });
    expect(shouldRenderEntry(entry, 'faq')).toBe(false);
  });

  it('returns true by default when no visibility flag is present', () => {
    expect(shouldRenderEntry(makeEntry(), 'faq')).toBe(true);
  });
});
