const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Format a date value for display as "Mon DD, YYYY".
 *
 * ISO dates/timestamps (e.g. a raw `publishedAt` like "2026-07-21T21:22:42.045708Z") are read in
 * UTC — via the date part only, so there's no off-by-one day shift from the viewer's timezone.
 * Values that are already human-readable (e.g. a hand-entered "Jul 02, 2024") pass through
 * unchanged, and empty input returns `undefined` so callers can omit the field.
 */
export function formatDisplayDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) {
    const [, year, month, day] = iso;
    const name = MONTHS[Number(month) - 1];
    if (name) return `${name} ${day}, ${year}`;
  }

  return trimmed;
}

/**
 * Pick `count` items deterministically from `items`, seeded by `pageSlug`.
 *
 * Same page → same selection on every build, different pages → different selections. Use for
 * rotating pull-quotes, value bands, related links: variety across the site without the
 * hydration mismatch a random pick would cause.
 */
export function selectValuesForPage<T>(items: T[], pageSlug: string, count = 4): T[] {
  const seeded = [...items];
  let seed = 0;

  for (const character of pageSlug) {
    seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  }

  for (let index = seeded.length - 1; index > 0; index -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;

    const target = seed % (index + 1);

    [seeded[index], seeded[target]] = [seeded[target], seeded[index]];
  }

  return seeded.slice(0, count);
}
