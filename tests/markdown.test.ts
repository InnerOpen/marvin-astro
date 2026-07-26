import { describe, expect, it } from 'vitest';
import { createMarkdownRenderer, preserveSoftBreaks } from '../src/markdown.js';

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
