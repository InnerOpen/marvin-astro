import type { MarvinFetcher } from './fetch.js';
import { createMarkdownRenderer, preserveSoftBreaks, type MarkdownRenderer } from './markdown.js';
import { asString, assetUrl, entryField, selectAssetByRole } from './normalize.js';
import type { SectionLanding } from './types.js';

export type SectionLandingOptions = {
  /** Asset role to use as the hero image. Default `'hero'`. */
  heroRole?: string;
  /** Field holding the intro copy. Default `'body'`, falling back to the entry summary. */
  bodyField?: string;
};

/**
 * Resolve a section-landing header from a Marvin `page` entry with the given slug.
 *
 * The intro is rendered with authored line breaks preserved — landing copy is written as a few
 * deliberate lines, not a soft-wrapped paragraph, and losing those breaks changes the layout.
 */
export async function loadSectionLanding(
  fetcher: MarvinFetcher,
  slug: string,
  renderMarkdown: MarkdownRenderer = createMarkdownRenderer(),
  options: SectionLandingOptions = {}
): Promise<SectionLanding> {
  const entry = await fetcher.entry(slug);
  if (!entry) return {};

  const source =
    asString(entryField(entry, options.bodyField ?? 'body')) ?? asString(entry.summary);

  return {
    title: asString(entry.title),
    introHtml: source ? await renderMarkdown(preserveSoftBreaks(source)) : undefined,
    hero: assetUrl(selectAssetByRole(entry, options.heroRole ?? 'hero')),
  };
}
