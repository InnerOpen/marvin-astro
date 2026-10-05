/**
 * Media embeds: the published shapes Marvin hands a site, read tolerantly.
 *
 * Marvin resolves a pasted provider link (YouTube, Vimeo, Spotify, …) on the server and publishes
 * the result next to the entry as `entry.embeds`, keyed by the URL exactly as the author wrote it.
 * Stored markdown is never rewritten: a site that knows about embeds swaps the link for the
 * player; an older site just shows the link.
 *
 * These types are declared here rather than imported from `@inneropen/marvin-sdk` so the package
 * works with SDKs that predate embeds. Kind and status are open-ended so a newer server value
 * doesn't break an older site's types.
 */

import { asRecord, asString } from './normalize.js';

export type MarvinEmbedKind = 'video' | 'audio' | 'podcast' | 'playlist';
export type MarvinEmbedStatus = 'ok' | 'link' | 'unavailable';
export type MarvinEmbedMode = 'direct' | 'click_to_load';

/** A Marvin-built iframe. Every value is already allow-listed and escaped server-side. */
export type MarvinEmbedIframe = {
  src: string;
  title: string;
  allow?: string;
  sandbox?: string;
  referrerpolicy?: string;
  /** CSS aspect ratio for video, e.g. `"16/9"`. */
  aspectRatio?: string;
  /** Fixed pixel height for audio players. */
  height?: number;
};

/** The plain link every embed falls back to. */
export type MarvinEmbedLink = {
  href: string;
  title: string;
  providerName: string;
};

export type MarvinEmbed = {
  /** The URL exactly as written in the content. */
  url: string;
  canonicalUrl?: string;
  /** Provider key, e.g. `youtube`. */
  provider: string;
  /** Display name, e.g. `YouTube`. */
  providerName: string;
  kind: MarvinEmbedKind | (string & {});
  /** `ok` has an iframe; `link` and `unavailable` render as a link card. */
  status: MarvinEmbedStatus | (string & {});
  title?: string | null;
  authorName?: string | null;
  thumbnailUrl?: string | null;
  iframe?: MarvinEmbedIframe | null;
  link: MarvinEmbedLink;
  /** Marvin-built HTML for the site's embed mode (an iframe, a click-to-load facade, or a link). */
  html: string;
};

/** `entry.embeds`: every resolved embed on the entry, keyed by the URL as written. */
export type MarvinEmbeds = Record<string, MarvinEmbed>;

/** `site.embeds`: the site's embed privacy mode and the frame sources a CSP must allow. */
export type MarvinSiteEmbeds = {
  mode: MarvinEmbedMode;
  consentText: string;
  /** Origins/hosts the site's embeds may frame — feed these into a `frame-src` directive. */
  frameSources: string[];
};

const EMBED_MODES = new Set<string>(['direct', 'click_to_load']);

function readEmbedsField(entry: unknown): unknown {
  if (!entry || typeof entry !== 'object') return undefined;
  const direct = (entry as { embeds?: unknown }).embeds;
  if (direct !== undefined) return direct;
  // The SDK's `Entry` class keeps the payload private; its `toJSON()` hands it back.
  const toJSON = (entry as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') {
    return asRecord(toJSON.call(entry)).embeds;
  }
  return undefined;
}

/**
 * The entry's `embeds` map, or `undefined` when it has none (an older server, or no embeds).
 * Values that aren't objects carrying a URL are dropped.
 */
export function entryEmbeds(entry: unknown): MarvinEmbeds | undefined {
  const raw = readEmbedsField(entry);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const embeds: MarvinEmbeds = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      embeds[key] = value as MarvinEmbed;
    }
  }
  return Object.keys(embeds).length > 0 ? embeds : undefined;
}

/** The embed for `url` as written, tolerating surrounding whitespace. */
export function findEmbed(
  embeds: MarvinEmbeds | null | undefined,
  url: string | null | undefined
): MarvinEmbed | undefined {
  if (!embeds || !url) return undefined;
  const key = url.trim();
  if (!key) return undefined;
  return Object.prototype.hasOwnProperty.call(embeds, key) ? embeds[key] : undefined;
}

/** Normalize `site.embeds`; `undefined` when the server doesn't send it. */
export function siteEmbeds(raw: unknown): MarvinSiteEmbeds | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = asRecord(raw);
  const mode = asString(value.mode);
  const frameSources = Array.isArray(value.frameSources)
    ? value.frameSources.filter(
        (source): source is string => typeof source === 'string' && source.trim().length > 0
      )
    : [];

  return {
    // Unknown or missing mode → the privacy-preserving default.
    mode: mode && EMBED_MODES.has(mode) ? (mode as MarvinEmbedMode) : 'click_to_load',
    consentText: asString(value.consentText) ?? '',
    frameSources,
  };
}
