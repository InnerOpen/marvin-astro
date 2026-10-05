import type { MarvinAsset } from '@inneropen/marvin-sdk';
import type { RendererEntry, RendererRequirement } from './types.js';
import { debug } from './debug.js';

const DEFAULT_RENDERER = 'page';

export function resolveRendererRequirement(entry: RendererEntry): RendererRequirement {
  const config = entry.entryTypeInfo?.config ?? {};
  const key = entry.entryTypeInfo?.renderer ?? DEFAULT_RENDERER;

  return {
    key,
    packageName: entry.entryTypeInfo?.package ?? undefined,
    versionRange: entry.entryTypeInfo?.version ?? undefined,
    config,
  };
}

export function resolveRendererName(entry: RendererEntry): string {
  const name = entry.entryTypeInfo?.renderer ?? DEFAULT_RENDERER;
  debug('resolveRendererName', { slug: entry.slug, renderer: name });
  return name;
}

export function resolveRendererConfig(
  entry: RendererEntry,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  const base = entry.entryTypeInfo?.config ?? {};
  const merged = overrides ? { ...base, ...overrides } : base;
  debug('resolveRendererConfig', { slug: entry.slug, config: merged });
  return merged;
}

/**
 * The entry's field bag, merging `dataJson` under `data` (per-key, `data` wins).
 *
 * `data` is a REQUIRED field on a published entry, so the older
 * `entry.data ?? entry.dataJson` short-circuited on an empty `{}` and never
 * consulted `dataJson` — making that fallback dead. Merging keeps published
 * behaviour identical (published entries carry no `dataJson`) while letting a
 * platform-shaped entry's `dataJson` supply keys `data` doesn't have, matching
 * how `extractField` already resolves values.
 */
function entryData(entry: RendererEntry): Record<string, unknown> {
  return { ...(entry.dataJson ?? {}), ...(entry.data ?? {}) };
}

export function extractBody(entry: RendererEntry): string | undefined {
  const body = entryData(entry).body;
  if (typeof body === 'string') return body;
  return entry.contentMarkdown;
}

export function extractField<T = unknown>(
  entry: RendererEntry,
  key: string,
): T | undefined {
  return (entry.data?.[key] ?? entry.dataJson?.[key]) as T | undefined;
}

export function getFeaturedAsset(
  entry: RendererEntry,
): MarvinAsset | undefined {
  const featuredAsset = normalizeEntryAsset(entry.featuredAsset);
  if (featuredAsset?.publicUrl) {
    debug('getFeaturedAsset', { slug: entry.slug, source: 'featuredAsset', url: featuredAsset.publicUrl });
    return featuredAsset as unknown as MarvinAsset;
  }

  const assets = entry.assets;
  if (!assets?.length) return undefined;

  const featured = assets.find(
    (a) => {
      const value = a as unknown as Record<string, unknown>;
      const role = value.role ?? (value.metadata as Record<string, unknown> | undefined)?.role;
      return role === 'featured' || role === 'hero';
    },
  );
  const result = normalizeEntryAsset(featured ?? assets[0]) as unknown as MarvinAsset | undefined;
  debug('getFeaturedAsset', { slug: entry.slug, source: featured ? 'role-match' : 'first-asset', url: result?.publicUrl });
  return result;
}

export function isRoutable(entry: RendererEntry): boolean {
  return entry.entryTypeInfo?.routable !== false;
}

export function shouldRenderEntry(entry: RendererEntry, rendererName?: string): boolean {
  const data = entryData(entry);
  const flags = [
    rendererName && typeof rendererName === 'string' ? data[rendererName] : undefined,
    data.enabled,
    data.visible,
    data.show,
    data.display,
    data.include,
  ].filter((value): value is unknown => value !== undefined);

  for (const value of flags) {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    }

    if (typeof value === 'number') {
      return value !== 0;
    }
  }

  return true;
}

function normalizeEntryAsset(asset: unknown): Record<string, unknown> | undefined {
  if (!asset || typeof asset !== 'object') return undefined;

  const value = asset as Record<string, unknown>;
  const nestedAsset = value.asset as Record<string, unknown> | undefined;
  if (!nestedAsset) return value;

  return {
    ...nestedAsset,
    role: value.role,
    position: value.position,
    metadata: value.metadata ?? value.metadataJson,
    metadataJson: value.metadataJson ?? nestedAsset.metadataJson,
  };
}
