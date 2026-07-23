/**
 * The field accessor handed to a repository's `transform`.
 *
 * Every reader defaults to the documented precedence — `data_json` first, `metadata_json`
 * second — so a transform reads like a field list instead of a pile of coalescing operators.
 */

import type { MarkdownRenderer } from './markdown.js';
import { preserveSoftBreaks } from './markdown.js';
import {
  asNumber,
  asRecord,
  asString,
  asStringArray,
  assetAlt,
  assetField,
  assetUrl,
  collectionRole,
  collectionSlugs,
  entryAssets,
  entryData,
  entryMetadata,
  entryResources,
  field,
  focalPoint,
  resourceField,
  selectAssetByRole,
  selectFeaturedAsset,
  selectIconAsset,
  selectImageAsset,
} from './normalize.js';
import { formatDisplayDate } from './format.js';
import type {
  ApiImage,
  ApiResourceLink,
  AssetSelectOptions,
  MarvinContentEntry,
} from './types.js';

export type ImageFieldOptions = Omit<AssetSelectOptions, 'type' | 'types'> & {
  /**
   * Exact roles to prefer, in order, before the looser role/usage match. Use for derived
   * variants — e.g. `['hero-grade']` to prefer a colour-graded hero over the raw upload.
   */
  preferRoles?: string[];
  /** `metadata_json` key holding a hand-authored `{src, alt, focalPoint}`. */
  metadataKey?: string | false;
  /** Alt text when the asset carries none. Defaults to the entry title. */
  alt?: string;
  /** Fall back to the list item's `featuredAsset`. Default `true`. */
  fallbackToFeatured?: boolean;
};

export type IconFieldOptions = {
  roles?: string[];
  /** Fall back to the list item's `featuredAsset` when no icon asset is attached. */
  fallbackToFeatured?: boolean;
};

export type MarkdownFieldOptions = {
  /** Keep authored single newlines as hard breaks. Default `false`. */
  softBreaks?: boolean;
};

export type ResourceFieldOptions = {
  /** Keep only these resource types, e.g. `['material', 'construction']`. */
  types?: string[];
  /** Keep only resources attached with this role. */
  role?: string;
  /** Build an href from the resource slug. */
  href?: (slug: string) => string;
};

const DEFAULT_IMAGE_ROLES = ['hero', 'featured', 'card'];

export type FieldAccessor = ReturnType<typeof createFieldAccessor>;

export type FieldAccessorContext = {
  renderMarkdown: MarkdownRenderer;
  /** The route this entry resolves to, if the repository was given an `href` builder. */
  href?: string;
  /** The collection the entry was loaded from, when it came from one. */
  collection?: string;
};

export function createFieldAccessor(
  entry: MarvinContentEntry,
  context: FieldAccessorContext
) {
  const title = asString((entry as { title?: unknown }).title);

  const accessor = {
    /** The entry itself, for anything the accessor doesn't cover. */
    entry,
    /** The route this entry resolves to (from the repository's `href` option). */
    href: context.href,
    collection: context.collection,

    /** `data_json` → `metadata_json`, untyped. */
    raw(key: string): unknown {
      return field(entry, key);
    },

    string(key: string): string | undefined {
      return asString(field(entry, key));
    },

    number(key: string): number | undefined {
      return asNumber(field(entry, key));
    },

    /** Booleans authored as strings (`"true"`, `"1"`, `"yes"`) read as booleans. */
    bool(key: string): boolean {
      const value = field(entry, key);
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
      }
      if (typeof value === 'number') return value !== 0;
      return Boolean(value);
    },

    /** A string array, tolerating a single string authored in place of a list. */
    list(key: string): string[] | undefined {
      const value = field(entry, key);
      const array = asStringArray(value);
      if (array) return array;
      const single = asString(value);
      return single ? [single] : undefined;
    },

    /**
     * An enum-guarded read: the value if it's in `allowed`, else `fallback`. Replaces the
     * per-field `normalizeStatus`/`normalizeCategory`/`normalizeTone` guards that every site
     * ends up writing.
     */
    oneOf<T extends string>(key: string, allowed: readonly T[] | Set<T>, fallback: T): T {
      const value = asString(field(entry, key));
      const set = allowed instanceof Set ? allowed : new Set<string>(allowed);
      return value && set.has(value as T) ? (value as T) : fallback;
    },

    /** A field read as a display date ("Mon DD, YYYY"); already-formatted values pass through. */
    date(key: string): string | undefined {
      return formatDisplayDate(asString(field(entry, key)));
    },

    /** The raw ISO publish timestamp, if any. */
    publishedAt(): string | undefined {
      const value = (entry as { publishedAt?: unknown }).publishedAt;
      return value != null ? String(value) : undefined;
    },

    /**
     * Render a markdown field to HTML. Falls back to the entry's `contentMarkdown` when the
     * named field is absent. Returns `undefined` when there is nothing to render, so the
     * caller can omit the property rather than emit an empty string.
     */
    async markdown(
      key = 'body',
      options: MarkdownFieldOptions = {}
    ): Promise<string | undefined> {
      const raw =
        field<string | string[]>(entry, key) ??
        (entry as { contentMarkdown?: string | string[] }).contentMarkdown;
      const source = Array.isArray(raw) ? raw.join('\n\n') : asString(raw);
      if (!source) return undefined;
      return context.renderMarkdown(options.softBreaks ? preserveSoftBreaks(source) : source);
    },

    /**
     * The entry's primary image. Checks, in order: a hand-authored `metadata_json.featuredImage`,
     * the exact `preferRoles`, a role/usage match over the entry's image assets, and finally the
     * list item's `featuredAsset`.
     */
    image(options: ImageFieldOptions = {}): ApiImage | undefined {
      const {
        preferRoles,
        metadataKey = 'featuredImage',
        alt: altFallback,
        fallbackToFeatured = true,
        roles = DEFAULT_IMAGE_ROLES,
        usages = DEFAULT_IMAGE_ROLES,
        allowUnroled = true,
        ...rest
      } = options;
      const fallbackAlt = altFallback ?? title ?? '';

      if (metadataKey) {
        const authored = asRecord(entryMetadata(entry)[metadataKey]);
        const src = asString(authored.src);
        if (src) {
          return {
            src,
            alt: asString(authored.alt) ?? fallbackAlt,
            focalPoint: focalPoint(authored.focalPoint),
          };
        }
      }

      const asset =
        (preferRoles?.length ? selectAssetByRole(entry, ...preferRoles) : undefined) ??
        selectImageAsset(entry, { ...rest, roles, usages, allowUnroled }) ??
        (fallbackToFeatured ? selectFeaturedAsset(entry) : undefined);

      const src = assetUrl(asset);
      if (!src) return undefined;

      return {
        src,
        alt: assetAlt(asset, fallbackAlt) ?? fallbackAlt,
        focalPoint: focalPoint(assetField(asset, 'focalPoint')),
      };
    },

    /** URL of the entry's icon asset (`role: icon`, SVG preferred). */
    icon(options: IconFieldOptions = {}): string | undefined {
      const { roles = ['icon'], fallbackToFeatured = false } = options;
      const asset = selectAssetByRole(entry, ...roles) ?? selectIconAsset(entry);
      return (
        assetUrl(asset) ?? (fallbackToFeatured ? assetUrl(selectFeaturedAsset(entry)) : undefined)
      );
    },

    /** The raw asset placement matching `options` — when you need more than src/alt/focal. */
    asset(options: AssetSelectOptions = {}): Record<string, unknown> | undefined {
      return selectImageAsset(entry, options) ?? selectFeaturedAsset(entry);
    },

    /** The asset whose role is EXACTLY one of `roles`, in preference order. */
    assetByRole(...roles: string[]): Record<string, unknown> | undefined {
      return selectAssetByRole(entry, ...roles);
    },

    /** All asset placements on the entry. */
    assets(): Record<string, unknown>[] {
      return entryAssets(entry);
    },

    /** Every image asset resolved, filtered by role/usage — support/detail galleries. */
    images(options: ImageFieldOptions = {}): (ApiImage & { usage?: string })[] {
      const wanted = new Set([...(options.roles ?? []), ...(options.usages ?? [])]);
      const fallbackAlt = options.alt ?? title ?? '';
      const images: (ApiImage & { usage?: string })[] = [];

      for (const asset of entryAssets(entry)) {
        const usage = asString(assetField(asset, 'usage')) ?? asString(assetField(asset, 'role'));
        const src = assetUrl(asset);
        if (!src) continue;
        if (wanted.size > 0 && (!usage || !wanted.has(usage))) continue;

        images.push({
          src,
          alt: assetAlt(asset, fallbackAlt) ?? fallbackAlt,
          focalPoint: focalPoint(assetField(asset, 'focalPoint')),
          usage,
        });
      }

      return images;
    },

    /** Attached resources, normalized to name/type/role/href. */
    resources(options: ResourceFieldOptions = {}): ApiResourceLink[] {
      const types = options.types?.length ? new Set(options.types) : undefined;

      return entryResources(entry)
        .map((relationship) => {
          const nested = asRecord(relationship.resource);
          const source = Object.keys(nested).length > 0 ? nested : relationship;
          const slug = asString(resourceField(source, 'slug'));
          return {
            name: asString(resourceField(source, 'name')) ?? '',
            type: asString(resourceField(source, 'resourceType')) ?? '',
            role: asString(assetField(relationship, 'role')),
            slug,
            href: slug && options.href ? options.href(slug) : undefined,
          };
        })
        .filter((resource) => Boolean(resource.name))
        .filter((resource) => !types || types.has(resource.type))
        .filter((resource) => !options.role || resource.role === options.role);
    },

    /** The first attached resource matching `options`. */
    resource(options: ResourceFieldOptions = {}): ApiResourceLink | undefined {
      return accessor.resources(options)[0];
    },

    /** The `metadata_json` blob. */
    metadata(): Record<string, unknown> {
      return entryMetadata(entry);
    },

    /** The `data_json` blob. Empty on a list item that was not hydrated. */
    data(): Record<string, unknown> {
      return entryData(entry);
    },

    /** Slugs of every collection the entry belongs to. */
    collections(): string[] {
      return collectionSlugs(entry);
    },

    /** The entry's membership role within `collectionSlug`. */
    role(collectionSlug: string): string | undefined {
      return collectionRole(entry, collectionSlug);
    },
  };

  return accessor;
}
