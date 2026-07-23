import { Marked, type MarkedOptions } from 'marked';

export type MarkdownOptions = MarkedOptions;

export type MarkdownRenderer = (
  markdown: string | string[] | null | undefined
) => Promise<string>;

/**
 * A markdown renderer with its own `marked` instance — options are per-site, not global, so two
 * `createMarvinContent()` instances in one process can't clobber each other's settings.
 *
 * `breaks: false` is the default because CMS body copy is authored as prose: a soft-wrapped
 * paragraph should render as one paragraph. Where authored line breaks must survive (a landing
 * intro, an address block), pass `breaks: true` or pre-convert with a trailing double space.
 */
export function createMarkdownRenderer(options: MarkdownOptions = {}): MarkdownRenderer {
  const marked = new Marked();
  marked.setOptions({ gfm: true, breaks: false, ...options });

  return async (markdown) => {
    const source = Array.isArray(markdown) ? markdown.join('\n\n') : (markdown ?? '');
    if (!source) return '';
    return await marked.parse(source);
  };
}

/** Turn single newlines into hard breaks, leaving paragraph breaks alone. */
export function preserveSoftBreaks(source: string): string {
  return source.replace(/(?<!\n)\n(?!\n)/g, '  \n');
}
