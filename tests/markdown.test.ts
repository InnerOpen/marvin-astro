import { describe, expect, it } from 'vitest';
import {
  createMarkdownRenderer,
  paragraphEmbedHtml,
  preserveSoftBreaks,
} from '../src/markdown.js';
import { FACADE_HTML, YOUTUBE_URL, youtubeEmbed } from './support/embeds.js';

describe('createMarkdownRenderer', () => {
  it('renders GFM markdown to HTML', async () => {
    const render = createMarkdownRenderer();
    expect(await render('**bold**')).toContain('<strong>bold</strong>');
  });

  it('returns an empty string for null, undefined, or empty input', async () => {
    const render = createMarkdownRenderer();
    expect(await render(null)).toBe('');
    expect(await render(undefined)).toBe('');
    expect(await render('')).toBe('');
  });

  it('joins an array of blocks with blank lines', async () => {
    const html = await createMarkdownRenderer()(['# One', 'Two']);
    expect(html).toContain('<h1>One</h1>');
    expect(html).toContain('<p>Two</p>');
  });

  it('does not turn single newlines into <br> by default', async () => {
    const html = await createMarkdownRenderer()('line one\nline two');
    expect(html).not.toContain('<br');
  });

  it('honours breaks: true (per-instance, not global)', async () => {
    const html = await createMarkdownRenderer({ breaks: true })('line one\nline two');
    expect(html).toContain('<br');
    // A separate default instance is unaffected.
    expect(await createMarkdownRenderer()('line one\nline two')).not.toContain('<br');
  });
});

describe('preserveSoftBreaks', () => {
  it('converts a single newline into a hard break', () => {
    expect(preserveSoftBreaks('a\nb')).toBe('a  \nb');
  });

  it('leaves paragraph breaks (double newline) alone', () => {
    expect(preserveSoftBreaks('a\n\nb')).toBe('a\n\nb');
  });
});

describe('embeds', () => {
  const render = createMarkdownRenderer();
  const embeds = { [YOUTUBE_URL]: youtubeEmbed() };

  it('renders a paragraph that is exactly an embedded URL as the embed html', async () => {
    const html = await render(`Intro.\n\n${YOUTUBE_URL}\n\nOutro.`, { embeds });
    expect(html).toContain(FACADE_HTML);
    expect(html).not.toContain(`<a href="${YOUTUBE_URL}"`);
    expect(html).toContain('<p>Intro.</p>');
    expect(html).toContain('<p>Outro.</p>');
  });

  it('tolerates surrounding whitespace on the URL line', async () => {
    expect(await render(`   ${YOUTUBE_URL}   `, { embeds })).toContain(FACADE_HTML);
  });

  it('works inside a blockquote paragraph', async () => {
    expect(await render(`> ${YOUTUBE_URL}`, { embeds })).toContain(FACADE_HTML);
  });

  it('leaves a bare URL without an embeds entry a link', async () => {
    const html = await render('https://example.com/other', { embeds });
    expect(html).toContain('<a href="https://example.com/other">');
    expect(html).not.toContain('marvin-embed');
  });

  it('renders the link as before when no embeds are passed', async () => {
    const html = await render(YOUTUBE_URL);
    expect(html).toBe(`<p><a href="${YOUTUBE_URL}">${YOUTUBE_URL}</a></p>\n`);
  });

  it('keeps <url>, [text](url) and a URL inside a sentence as links', async () => {
    for (const source of [
      `<${YOUTUBE_URL}>`,
      `[Watch it](${YOUTUBE_URL})`,
      `Watch ${YOUTUBE_URL} now.`,
      `${YOUTUBE_URL} is the one`,
      `${YOUTUBE_URL}\n${YOUTUBE_URL}`,
    ]) {
      const html = await render(source, { embeds });
      expect(html, source).not.toContain('marvin-embed');
      expect(html, source).toContain(`href="${YOUTUBE_URL}"`);
    }
  });

  it('never touches code', async () => {
    const fenced = await render(`\`\`\`\n${YOUTUBE_URL}\n\`\`\``, { embeds });
    const indented = await render(`Code:\n\n    ${YOUTUBE_URL}`, { embeds });
    const inline = await render(`\`${YOUTUBE_URL}\``, { embeds });
    for (const html of [fenced, indented, inline]) {
      expect(html).not.toContain('marvin-embed');
      expect(html).toContain(YOUTUBE_URL);
    }
  });

  it('falls back to the link when the embed has no html', async () => {
    const html = await render(YOUTUBE_URL, {
      embeds: { [YOUTUBE_URL]: youtubeEmbed({ html: '' }) },
    });
    expect(html).toContain(`<a href="${YOUTUBE_URL}">`);
  });

  it('does not leak one call’s embeds into the next', async () => {
    expect(await render(YOUTUBE_URL, { embeds })).toContain(FACADE_HTML);
    expect(await render(YOUTUBE_URL)).not.toContain('marvin-embed');
  });

  it('keeps per-instance options (breaks) alongside embeds', async () => {
    const html = await createMarkdownRenderer({ breaks: true })(
      `one\ntwo\n\n${YOUTUBE_URL}`,
      { embeds }
    );
    expect(html).toContain('<br');
    expect(html).toContain(FACADE_HTML);
  });
});

describe('paragraphEmbedHtml', () => {
  it('only matches http(s) URLs', () => {
    const embeds = { 'javascript:alert(1)': youtubeEmbed() };
    expect(paragraphEmbedHtml({ text: 'javascript:alert(1)' }, embeds)).toBeUndefined();
  });
});
