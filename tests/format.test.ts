import { describe, expect, it } from 'vitest';
import { formatDisplayDate, selectValuesForPage } from '../src/format.js';
import { createMarkdownRenderer, preserveSoftBreaks } from '../src/markdown.js';

describe('formatDisplayDate', () => {
  it('formats an ISO date', () => {
    expect(formatDisplayDate('2024-07-02')).toBe('Jul 02, 2024');
  });

  it('reads an ISO timestamp in UTC, so the day never shifts with the viewer timezone', () => {
    // 21:22 UTC is the next day in +03:00 and the previous day nowhere — parsing the date part
    // directly is what keeps a published-at stamp on the day it was published.
    expect(formatDisplayDate('2026-07-21T21:22:42.045708Z')).toBe('Jul 21, 2026');
    expect(formatDisplayDate('2026-01-01T00:30:00-05:00')).toBe('Jan 01, 2026');
  });

  it('passes an already human-readable date through unchanged', () => {
    expect(formatDisplayDate('Jul 02, 2024')).toBe('Jul 02, 2024');
    expect(formatDisplayDate('Summer 2024')).toBe('Summer 2024');
  });

  it('returns undefined for empty input so callers can omit the field', () => {
    expect(formatDisplayDate('')).toBeUndefined();
    expect(formatDisplayDate('   ')).toBeUndefined();
    expect(formatDisplayDate(null)).toBeUndefined();
    expect(formatDisplayDate(undefined)).toBeUndefined();
  });

  it('does not invent a month for an out-of-range value', () => {
    expect(formatDisplayDate('2024-13-02')).toBe('2024-13-02');
  });
});

describe('selectValuesForPage', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('is deterministic for a given page slug', () => {
    expect(selectValuesForPage(items, 'about', 3)).toEqual(selectValuesForPage(items, 'about', 3));
  });

  it('differs between pages', () => {
    expect(selectValuesForPage(items, 'about', 3)).not.toEqual(
      selectValuesForPage(items, 'projects', 3)
    );
  });

  it('returns count items, without duplicates, drawn from the input', () => {
    const picked = selectValuesForPage(items, 'bench-notes', 3);

    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    expect(picked.every((item) => items.includes(item))).toBe(true);
  });

  it('does not mutate the input', () => {
    const original = [...items];
    selectValuesForPage(items, 'about', 3);

    expect(items).toEqual(original);
  });

  it('caps at the available count', () => {
    expect(selectValuesForPage(['a'], 'about', 4)).toEqual(['a']);
    expect(selectValuesForPage([], 'about')).toEqual([]);
  });
});

describe('markdown', () => {
  it('renders GFM by default', async () => {
    const render = createMarkdownRenderer();

    expect(await render('| a |\n| - |\n| 1 |')).toContain('<table>');
  });

  it('does not turn soft wraps into breaks by default', async () => {
    const render = createMarkdownRenderer();

    expect(await render('one\ntwo')).not.toContain('<br>');
  });

  it('accepts option overrides per instance', async () => {
    const render = createMarkdownRenderer({ breaks: true });

    expect(await render('one\ntwo')).toContain('<br>');
    // A second instance keeps the defaults — options are not global state.
    expect(await createMarkdownRenderer()('one\ntwo')).not.toContain('<br>');
  });

  it('joins an array source with paragraph breaks and tolerates nullish input', async () => {
    const render = createMarkdownRenderer();

    expect(await render(['one', 'two'])).toBe('<p>one</p>\n<p>two</p>\n');
    expect(await render(null)).toBe('');
    expect(await render(undefined)).toBe('');
  });

  it('preserveSoftBreaks only touches single newlines', () => {
    expect(preserveSoftBreaks('one\ntwo')).toBe('one  \ntwo');
    expect(preserveSoftBreaks('one\n\ntwo')).toBe('one\n\ntwo');
  });
});
