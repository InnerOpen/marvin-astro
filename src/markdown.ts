import { Marked, type MarkedOptions, type Tokens } from 'marked';
import { findEmbed, type MarvinEmbeds } from './embeds.js';

export type MarkdownOptions = MarkedOptions;

/** Per-call options for a {@link MarkdownRenderer}. */
export type RenderMarkdownOptions = {
  /**
   * The entry's `embeds` map. A paragraph that is exactly a URL with an entry here renders as
   * that embed's Marvin-built HTML instead of a link.
   */
  embeds?: MarvinEmbeds | null;
};

export type MarkdownRenderer = (
  markdown: string | string[] | null | undefined,
  options?: RenderMarkdownOptions
) => Promise<string>;

// Per-call data rides on marked's parse options: marked merges them over the instance defaults and
// hands the merged object to the renderer as `this.options` for that parse only. A symbol key
// keeps it clear of marked's own option names.
const EMBEDS = Symbol('marvin.embeds');
type ParseOptionsWithEmbeds = MarkedOptions & { [EMBEDS]?: MarvinEmbeds | null };

// One run of non-space characters starting with a scheme. `<url>`, `[text](url)` and a URL inside
// a sentence all fail this, so they stay links.
const BARE_URL = /^https?:\/\/\S+$/i;

/**
 * The embed for a paragraph that is exactly a URL with an `embeds` entry, else `undefined`.
 * Exported for tests; the renderer below is the only caller.
 */
export function paragraphEmbedHtml(
  token: Pick<Tokens.Paragraph, 'text'>,
  embeds: MarvinEmbeds | null | undefined
): string | undefined {
  if (!embeds) return undefined;
  const text = token.text.trim();
  if (!BARE_URL.test(text)) return undefined;
  const html = findEmbed(embeds, text)?.html;
  return typeof html === 'string' && html.trim() ? html : undefined;
}

/**
 * A markdown renderer with its own `marked` instance — options are per-site, not global, so two
 * `createMarvinContent()` instances in one process can't clobber each other's settings.
 *
 * `breaks: false` is the default because CMS body copy is authored as prose: a soft-wrapped
 * paragraph should render as one paragraph. Where authored line breaks must survive (a landing
 * intro, an address block), pass `breaks: true` or pre-convert with a trailing double space.
 *
 * Pass the entry's `embeds` to turn a bare provider URL on its own line into its player:
 *
 * ```ts
 * await renderMarkdown(body, { embeds: entryEmbeds(entry) });
 * ```
 */
export function createMarkdownRenderer(options: MarkdownOptions = {}): MarkdownRenderer {
  const marked = new Marked();
  marked.setOptions({ gfm: true, breaks: false, ...options });
  marked.use({
    renderer: {
      paragraph(token) {
        const embeds = (this.options as ParseOptionsWithEmbeds)[EMBEDS];
        const html = paragraphEmbedHtml(token, embeds);
        // `false` hands the token back to marked's default paragraph renderer.
        return html === undefined ? false : `${html}\n`;
      },
    },
  });

  return async (markdown, renderOptions = {}) => {
    const source = Array.isArray(markdown) ? markdown.join('\n\n') : (markdown ?? '');
    if (!source) return '';
    const parseOptions: ParseOptionsWithEmbeds = { [EMBEDS]: renderOptions.embeds ?? null };
    return await marked.parse(source, parseOptions);
  };
}

/** Turn single newlines into hard breaks, leaving paragraph breaks alone. */
export function preserveSoftBreaks(source: string): string {
  return source.replace(/(?<!\n)\n(?!\n)/g, '  \n');
}
