/**
 * Reading Marvin payloads.
 *
 * The published API returns the same logical value in several shapes depending on which
 * endpoint produced it (list item vs full read, SDK `Entry` wrapper vs raw JSON, placement
 * metadata vs asset metadata). Every reader here is total: it takes `unknown`, checks, and
 * returns `undefined` rather than throwing.
 */

import type { AssetSelectOptions, MarvinContentEntry } from './types.js';

/** A non-empty string, or `undefined`. Empty/whitespace strings are treated as absent. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const items = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  );
  return items.length > 0 ? items : undefined;
}

/** `metadata_json` — the free-form blob every entry carries, whatever its schema. */
export function entryMetadata(entry: MarvinContentEntry): Record<string, unknown> {
  const value = entry as { metadata?: unknown; metadataJson?: unknown };
  return asRecord(value.metadata ?? value.metadataJson);
}

/** `data_json` — the schema-defined fields. Absent on list items until hydrated. */
export function entryData(entry: MarvinContentEntry): Record<string, unknown> {
  const value = entry as { data?: unknown; dataJson?: unknown };
  return asRecord(value.data ?? value.dataJson);
}

/**
 * Read a schema field (`data_json`) from an entry, through the SDK's `Entry` accessor when
 * present and off the raw payload otherwise.
 */
export function entryField<T = unknown>(entry: MarvinContentEntry, key: string): T | undefined {
  const accessor = (entry as { field?: (key: string) => unknown }).field;
  if (typeof accessor === 'function') {
    return accessor.call(entry, key) as T | undefined;
  }
  return entryData(entry)[key] as T | undefined;
}

/**
 * The precedence rule: structured schema field first (`data_json`), legacy blob second
 * (`metadata_json`).
 *
 * An empty string counts as absent, which matters more than it sounds — an entry type that
 * declares a field the author left blank stores `""`, and without this the legacy value that
 * *is* set would never surface.
 */
export function field<T = unknown>(entry: MarvinContentEntry, key: string): T | undefined {
  const value = entryField(entry, key);
  if (value !== undefined && value !== null && value !== '') return value as T;
  const fallback = entryMetadata(entry)[key];
  return (fallback === '' ? undefined : fallback) as T | undefined;
}

/**
 * Read a value off a published asset placement, checking every level the API might have put it
 * at: the placement itself, its metadata blobs, then the underlying asset and its blobs.
 */
export function assetField<T = unknown>(asset: unknown, key: string): T | undefined {
  if (!asset || typeof asset !== 'object') return undefined;

  const value = asset as Record<string, unknown>;
  const nested = asRecord(value.asset);
  return (value[key] ??
    asRecord(value.entryMetadata)[key] ??
    asRecord(value.placementMetadata)[key] ??
    asRecord(value.metadataJson)[key] ??
    asRecord(value.metadata_)[key] ??
    asRecord(value.metadata)[key] ??
    nested[key] ??
    asRecord(nested.metadataJson)[key] ??
    asRecord(nested.metadata_)[key] ??
    asRecord(nested.metadata)[key]) as T | undefined;
}

/** Same layered read as {@link assetField}, for resource relationships. */
export function resourceField<T = unknown>(resource: unknown, key: string): T | undefined {
  if (!resource || typeof resource !== 'object') return undefined;

  const value = resource as Record<string, unknown>;
  const nested = asRecord(value.resource);
  return (value[key] ??
    asRecord(value.entryMetadata)[key] ??
    asRecord(value.metadataJson)[key] ??
    asRecord(value.metadata_)[key] ??
    asRecord(value.metadata)[key] ??
    nested[key] ??
    asRecord(nested.metadataJson)[key] ??
    asRecord(nested.metadata_)[key] ??
    asRecord(nested.metadata)[key]) as T | undefined;
}

/**
 * The entry's collection memberships as slugs. Collections arrive as bare slugs on list items,
 * flat `{slug}` objects, or the SDK's nested `{collection: {slug}}` — all three are read here.
 */
export function collectionSlugs(entry: MarvinContentEntry): string[] {
  const direct = (entry as { collectionSlugs?: unknown }).collectionSlugs;
  if (Array.isArray(direct)) {
    return direct.filter((slug): slug is string => typeof slug === 'string');
  }

  const raw = (entry as { collections?: unknown }).collections;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) =>
      typeof item === 'string' ? item : (asRecord(asRecord(item).collection).slug ?? asRecord(item).slug)
    )
    .filter((slug): slug is string => typeof slug === 'string');
}

/**
 * The entry's membership role within one specific collection (e.g. `'legal'` in
 * `footer-navigation`). A hydrated entry carries all of its memberships; this finds the one for
 * the given collection.
 */
export function collectionRole(
  entry: MarvinContentEntry,
  collectionSlug: string
): string | undefined {
  const raw = (entry as { collections?: unknown }).collections;
  if (!Array.isArray(raw)) return undefined;

  for (const item of raw) {
    if (typeof item === 'string') continue;
    const record = asRecord(item);
    const slug = asString(record.slug) ?? asString(asRecord(record.collection).slug);
    if (slug === collectionSlug) {
      return asString(asRecord(record.entryMetadata).role) ?? asString(record.role);
    }
  }
  return undefined;
}

/**
 * A CSS `object-position` value from a focal point. Marvin stores these either pre-formatted
 * (`"40% 60%"`) or as `{x, y}` in 0–1 or 0–100 units.
 */
export function focalPoint(value: unknown): string | undefined {
  const direct = asString(value);
  if (direct) return direct;

  const point = asRecord(value);
  const x = typeof point.x === 'number' ? point.x : undefined;
  const y = typeof point.y === 'number' ? point.y : undefined;
  if (x == null || y == null) return undefined;

  return `${x > 1 ? x : x * 100}% ${y > 1 ? y : y * 100}%`;
}

export function entryAssets(entry: MarvinContentEntry): Record<string, unknown>[] {
  const assets = (entry as { assets?: unknown }).assets;
  return Array.isArray(assets) ? (assets as Record<string, unknown>[]) : [];
}

export function entryResources(entry: MarvinContentEntry): Record<string, unknown>[] {
  const resources = (entry as { resources?: unknown }).resources;
  return Array.isArray(resources) ? (resources as Record<string, unknown>[]) : [];
}

function includesPreferred(actual: string | undefined, exact?: string, any?: string[]): boolean {
  if (!exact && !any?.length) return true;
  if (!actual) return false;
  return actual === exact || Boolean(any?.includes(actual));
}

function assetMatches(asset: Record<string, unknown>, options: AssetSelectOptions): boolean {
  const role = asString(assetField(asset, 'role'));
  const usage = asString(assetField(asset, 'usage'));
  const type = asString(assetField(asset, 'assetType'));
  const mimeType = asString(assetField(asset, 'mimeType'));

  const hasRoleCriteria = Boolean(options.role || options.roles?.length);
  const hasUsageCriteria = Boolean(options.usage || options.usages?.length);
  const roleMatches = includesPreferred(role, options.role, options.roles);
  const usageMatches = includesPreferred(usage, options.usage, options.usages);
  const typeMatches = includesPreferred(type, options.type, options.types);
  const mimeMatches = options.mimeType ? mimeType === options.mimeType : true;
  const unroledAllowed = Boolean(options.allowUnroled) && !role && !usage;

  // Role and usage are alternatives, not a conjunction: an asset placed with `role: hero` and
  // one placed with `usage: hero` both satisfy a hero request.
  const relationshipMatches =
    hasRoleCriteria || hasUsageCriteria ? roleMatches || usageMatches || unroledAllowed : true;

  return relationshipMatches && typeMatches && mimeMatches;
}

export function selectEntryAsset(
  entry: MarvinContentEntry,
  options: AssetSelectOptions = {}
): Record<string, unknown> | undefined {
  return entryAssets(entry).find((asset) => assetMatches(asset, options));
}

/**
 * Match on role ALONE, exactly. `selectEntryAsset` ORs role against a vacuously-true usage
 * check, so `{roles: ['hero-grade']}` there matches the entry's first asset whatever its role.
 * When you mean "the asset whose role is exactly this", use this.
 */
export function selectAssetByRole(
  entry: MarvinContentEntry,
  ...roles: string[]
): Record<string, unknown> | undefined {
  for (const role of roles) {
    const found = entryAssets(entry).find((asset) => asString(assetField(asset, 'role')) === role);
    if (found) return found;
  }
  return undefined;
}

/** The list-item shorthand: `featuredAsset` is present on collection entries. */
export function selectFeaturedAsset(
  entry: MarvinContentEntry
): Record<string, unknown> | undefined {
  const featured = asRecord((entry as { featuredAsset?: unknown }).featuredAsset);
  return Object.keys(featured).length > 0 ? featured : undefined;
}

export function selectImageAsset(
  entry: MarvinContentEntry,
  options: Omit<AssetSelectOptions, 'type' | 'types'> = {}
): Record<string, unknown> | undefined {
  return (
    selectEntryAsset(entry, { ...options, type: 'image' }) ??
    selectEntryAsset(entry, { ...options, types: ['image'], allowUnroled: true })
  );
}

export function selectIconAsset(entry: MarvinContentEntry): Record<string, unknown> | undefined {
  return (
    selectEntryAsset(entry, {
      roles: ['icon'],
      types: ['svg', 'image'],
      mimeType: 'image/svg+xml',
      allowUnroled: true,
    }) ??
    selectEntryAsset(entry, {
      roles: ['icon'],
      types: ['svg', 'image'],
      allowUnroled: true,
    })
  );
}

export function assetUrl(asset: unknown): string | undefined {
  return asString(assetField(asset, 'publicUrl'));
}

export function assetAlt(asset: unknown, fallback?: string): string | undefined {
  return asString(assetField(asset, 'altText')) ?? fallback;
}

export function resourceRole(resource: unknown): string | undefined {
  return asString(resourceField(resource, 'role'));
}

export function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|tel:)/.test(href);
}
