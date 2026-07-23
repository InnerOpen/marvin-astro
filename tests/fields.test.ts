import { describe, expect, it } from 'vitest';
import { createFieldAccessor } from '../src/fields.js';
import { createMarkdownRenderer } from '../src/markdown.js';
import { asEntry, projectRead, referenceRead } from './support/fixtures.js';
import type { MarvinContentEntry } from '../src/types.js';

const renderMarkdown = createMarkdownRenderer();

function fieldsOf(entry: unknown, href?: string) {
  return createFieldAccessor(entry as MarvinContentEntry, { renderMarkdown, href });
}

describe('scalar readers', () => {
  const f = fieldsOf({
    title: 'A jacket',
    data: { projectNumber: 'P-04', hours: 38, blank: '', published: 'true', tags: 'canvas' },
    metadataJson: { blank: 'from metadata', featured: true, legacyOnly: 'yes' },
  });

  it('string reads data_json and skips blanks', () => {
    expect(f.string('projectNumber')).toBe('P-04');
    expect(f.string('blank')).toBe('from metadata');
    expect(f.string('missing')).toBeUndefined();
  });

  it('number coerces numeric strings and rejects the rest', () => {
    expect(f.number('hours')).toBe(38);
    expect(f.number('projectNumber')).toBeUndefined();
    expect(fieldsOf({ data: { order: '12' } }).number('order')).toBe(12);
  });

  it('bool reads booleans authored as strings', () => {
    expect(f.bool('published')).toBe(true);
    expect(f.bool('featured')).toBe(true);
    expect(f.bool('missing')).toBe(false);
    expect(fieldsOf({ data: { featured: 'false' } }).bool('featured')).toBe(false);
  });

  it('list tolerates a single string authored where a list was expected', () => {
    expect(f.list('tags')).toEqual(['canvas']);
    expect(fieldsOf({ data: { tags: ['canvas', 'wool'] } }).list('tags')).toEqual([
      'canvas',
      'wool',
    ]);
    expect(f.list('missing')).toBeUndefined();
  });
});

describe('oneOf', () => {
  const STATUSES = ['available', 'archived', 'prototype'] as const;

  it('returns the value when it is in the allowed set', () => {
    expect(fieldsOf({ data: { status: 'archived' } }).oneOf('status', STATUSES, 'available')).toBe(
      'archived'
    );
  });

  it('returns the fallback for an unknown, empty, or absent value', () => {
    expect(fieldsOf({ data: { status: 'retired' } }).oneOf('status', STATUSES, 'available')).toBe(
      'available'
    );
    expect(fieldsOf({ data: {} }).oneOf('status', STATUSES, 'available')).toBe('available');
  });

  it('accepts a Set as well as an array', () => {
    expect(
      fieldsOf({ data: { status: 'prototype' } }).oneOf(
        'status',
        new Set(STATUSES),
        'available'
      )
    ).toBe('prototype');
  });
});

describe('markdown', () => {
  it('renders the named field to HTML', async () => {
    const html = await fieldsOf(asEntry(referenceRead)).markdown('body');

    expect(html).toContain('<h2>');
    expect(html).toContain('Do You Release Collections?');
  });

  it('returns undefined when there is nothing to render', async () => {
    expect(await fieldsOf({ data: {} }).markdown('body')).toBeUndefined();
    expect(await fieldsOf({ data: { body: '   ' } }).markdown('body')).toBeUndefined();
  });

  it('joins an array body with paragraph breaks', async () => {
    const html = await fieldsOf({ data: { body: ['One.', 'Two.'] } }).markdown('body');

    expect(html).toBe('<p>One.</p>\n<p>Two.</p>\n');
  });

  it('keeps soft line breaks only when asked', async () => {
    const entry = { data: { body: 'First line\nSecond line' } };

    expect(await fieldsOf(entry).markdown('body')).not.toContain('<br>');
    expect(await fieldsOf(entry).markdown('body', { softBreaks: true })).toContain('<br>');
  });

  it('falls back to contentMarkdown', async () => {
    const html = await fieldsOf({ data: {}, contentMarkdown: '# Title' }).markdown('body');

    expect(html).toContain('<h1>');
  });
});

describe('image', () => {
  it('prefers a hand-authored metadata image over any attached asset', () => {
    const image = fieldsOf({
      title: 'Note',
      metadataJson: { featuredImage: { src: '/static/hero.jpg', focalPoint: '30% 40%' } },
      assets: [{ role: 'hero', asset: { assetType: 'image', publicUrl: '/cms/hero.jpg' } }],
    }).image();

    expect(image).toEqual({ src: '/static/hero.jpg', alt: 'Note', focalPoint: '30% 40%' });
  });

  it('prefers an exact preferRole over the looser role/usage match', () => {
    const image = fieldsOf({
      title: 'Jacket',
      assets: [
        { role: 'hero', asset: { assetType: 'image', publicUrl: '/raw.jpg' } },
        { role: 'hero-grade', asset: { assetType: 'image', publicUrl: '/graded.jpg' } },
      ],
    }).image({ preferRoles: ['hero-grade'] });

    expect(image?.src).toBe('/graded.jpg');
  });

  it('falls back to the entry title for alt text', () => {
    const image = fieldsOf({
      title: 'Waxed tote',
      assets: [{ role: 'hero', usage: 'hero', asset: { assetType: 'image', publicUrl: '/a.jpg' } }],
    }).image();

    expect(image?.alt).toBe('Waxed tote');
  });

  it('normalizes a {x, y} focal point to a CSS position', () => {
    const image = fieldsOf({
      title: 'Tote',
      assets: [
        {
          role: 'hero',
          usage: 'hero',
          focalPoint: { x: 0.25, y: 0.75 },
          asset: { assetType: 'image', publicUrl: '/a.jpg' },
        },
      ],
    }).image();

    expect(image?.focalPoint).toBe('25% 75%');
  });

  it('falls back to the list item featuredAsset', () => {
    const image = fieldsOf({
      title: 'FAQ',
      featuredAsset: { publicUrl: '/envelope.svg', altText: 'Envelope' },
    }).image();

    expect(image).toEqual({ src: '/envelope.svg', alt: 'Envelope', focalPoint: undefined });
  });

  it('returns undefined when the entry has no usable image', () => {
    expect(fieldsOf({ title: 'Nothing', assets: [] }).image()).toBeUndefined();
  });

  it('resolves a real image off the live project fixture', () => {
    const image = fieldsOf(projectRead).image({ roles: ['support'], usages: ['support'] });

    expect(image?.src).toMatch(/^https?:\/\//);
  });
});

describe('icon', () => {
  it('picks the asset whose role is exactly icon', () => {
    const icon = fieldsOf({
      assets: [
        { role: 'hero', asset: { assetType: 'image', publicUrl: '/hero.jpg' } },
        { role: 'icon', asset: { assetType: 'svg', publicUrl: '/icon.svg' } },
      ],
    }).icon();

    expect(icon).toBe('/icon.svg');
  });

  it('only uses featuredAsset when asked to', () => {
    const entry = { featuredAsset: { publicUrl: '/envelope.svg' } };

    expect(fieldsOf(entry).icon()).toBeUndefined();
    expect(fieldsOf(entry).icon({ fallbackToFeatured: true })).toBe('/envelope.svg');
  });
});

describe('images', () => {
  it('collects every asset matching the requested usages', () => {
    const images = fieldsOf(projectRead).images({ usages: ['support'] });

    expect(images.length).toBeGreaterThan(0);
    expect(images.every((image) => image.usage === 'support')).toBe(true);
  });

  it('returns everything with a URL when no usage filter is given', () => {
    expect(fieldsOf(projectRead).images().length).toBeGreaterThanOrEqual(
      fieldsOf(projectRead).images({ usages: ['support'] }).length
    );
  });
});

describe('resources', () => {
  it('normalizes attached resources and filters by type', () => {
    const materials = fieldsOf(projectRead).resources({
      types: ['material'],
      href: (slug) => `/materials/${slug}`,
    });

    expect(materials[0]).toMatchObject({
      name: 'Herringbone Twill',
      type: 'material',
      role: 'primary-material',
      href: '/materials/herringbone-twill',
    });
  });

  it('filters by relationship role', () => {
    expect(fieldsOf(projectRead).resources({ role: 'not-a-role' })).toEqual([]);
    expect(fieldsOf(projectRead).resource({ role: 'primary-material' })?.name).toBe(
      'Herringbone Twill'
    );
  });

  it('returns an empty list for an entry with no resources', () => {
    expect(fieldsOf({}).resources()).toEqual([]);
    expect(fieldsOf({}).resource()).toBeUndefined();
  });
});

describe('context', () => {
  it('exposes the resolved href, metadata, data, collections and membership role', () => {
    const f = fieldsOf(projectRead, '/projects/field-jacket');

    expect(f.href).toBe('/projects/field-jacket');
    expect(f.data()).not.toEqual({});
    expect(f.collections()).toContain('projects');
    expect(f.metadata()).toBeTypeOf('object');
  });

  it('reads publishedAt as a string', () => {
    expect(fieldsOf({ publishedAt: '2026-07-16T02:02:45.246149Z' }).publishedAt()).toBe(
      '2026-07-16T02:02:45.246149Z'
    );
    expect(fieldsOf({}).publishedAt()).toBeUndefined();
  });

  it('formats a date field for display', () => {
    expect(fieldsOf({ data: { date: '2024-07-02' } }).date('date')).toBe('Jul 02, 2024');
  });
});
