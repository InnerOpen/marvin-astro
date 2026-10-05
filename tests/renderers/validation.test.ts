import { describe, it, expect } from 'vitest';
import { validateRenderers } from '../../src/renderers/validation';
import { createRegistry } from '../../src/renderers/registry';

const makeEntryType = (
  slug: string,
  name: string,
  renderer?: string,
  pkg?: string,
  version?: string
) => ({
  slug,
  name,
  isRendered: !!renderer,
  rendering: renderer ? { renderer, package: pkg, version } : undefined,
});

describe('validateRenderers', () => {
  const registry = createRegistry({
    page: 'PageComponent',
    article: 'ArticleComponent',
    faq: 'FaqComponent',
  });

  it('returns all covered when every renderer is in the registry', () => {
    const entryTypes = [
      makeEntryType('page', 'Page', 'page'),
      makeEntryType('article', 'Article', 'article'),
    ];

    const result = validateRenderers(entryTypes, registry);

    expect(result.total).toBe(2);
    expect(result.covered).toBe(2);
    expect(result.missing).toEqual([]);
  });

  it('identifies missing renderers', () => {
    const entryTypes = [
      makeEntryType('page', 'Page', 'page'),
      makeEntryType('project', 'Project', 'project-gallery', '@custom/renderers', '^1.0.0'),
    ];

    const result = validateRenderers(entryTypes, registry);

    expect(result.total).toBe(2);
    expect(result.covered).toBe(1);
    expect(result.missing).toEqual([
      {
        entryTypeSlug: 'project',
        entryTypeName: 'Project',
        renderer: 'project-gallery',
        package: '@custom/renderers',
        version: '^1.0.0',
      },
    ]);
  });

  it('skips entry types without a renderer', () => {
    const entryTypes = [
      makeEntryType('page', 'Page', 'page'),
      makeEntryType('nav-item', 'Navigation Item'),
    ];

    const result = validateRenderers(entryTypes, registry);

    expect(result.total).toBe(1);
    expect(result.covered).toBe(1);
    expect(result.missing).toEqual([]);
  });

  it('respects the ignore list', () => {
    const entryTypes = [
      makeEntryType('page', 'Page', 'page'),
      makeEntryType('project', 'Project', 'project-gallery'),
    ];

    const result = validateRenderers(entryTypes, registry, {
      ignore: ['project'],
    });

    expect(result.total).toBe(1);
    expect(result.covered).toBe(1);
    expect(result.missing).toEqual([]);
  });

  it('works with a plain Record instead of RendererRegistry', () => {
    const plainMap = { page: true, article: true };

    const entryTypes = [
      makeEntryType('page', 'Page', 'page'),
      makeEntryType('article', 'Article', 'article'),
      makeEntryType('faq', 'FAQ', 'faq'),
    ];

    const result = validateRenderers(entryTypes, plainMap);

    expect(result.total).toBe(3);
    expect(result.covered).toBe(2);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]!.renderer).toBe('faq');
  });

  it('handles empty entry types array', () => {
    const result = validateRenderers([], registry);

    expect(result.total).toBe(0);
    expect(result.covered).toBe(0);
    expect(result.missing).toEqual([]);
  });

  it('handles all entry types missing renderers', () => {
    const entryTypes = [
      makeEntryType('custom-a', 'Custom A', 'custom-a'),
      makeEntryType('custom-b', 'Custom B', 'custom-b'),
    ];

    const result = validateRenderers(entryTypes, registry);

    expect(result.total).toBe(2);
    expect(result.covered).toBe(0);
    expect(result.missing).toHaveLength(2);
  });
});
