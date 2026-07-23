/**
 * Fixtures captured from a live Marvin workspace (`/api/publish/<ws>/…`), not hand-written.
 * Payload shape drift is the whole class of bug these tests exist to catch, so invented
 * fixtures would defeat the point.
 */

import { Entry } from '@inneropen/marvin-sdk';
import type { CollectionEntry, MarvinAsset, MarvinEntry, MarvinSite } from '@inneropen/marvin-sdk';

import collectionPayload from '../fixtures/collection-entries.json';
import footerPayload from '../fixtures/footer-navigation-entries.json';
import mainNavPayload from '../fixtures/main-navigation-entries.json';
import projectEntry from '../fixtures/entry-project.json';
import referenceEntry from '../fixtures/entry-reference.json';
import sitePayload from '../fixtures/site.json';

type CollectionPayload = { slug: string; entries: unknown[] };

function entriesOf(payload: unknown): CollectionEntry[] {
  return (payload as CollectionPayload).entries as CollectionEntry[];
}

/** `workshop-reference` list items — no `data_json`, exactly as the collection endpoint sends. */
export const workshopReferenceListItems = entriesOf(collectionPayload);
export const footerNavigationListItems = entriesOf(footerPayload);
export const mainNavigationListItems = entriesOf(mainNavPayload);

/** Full reads — these DO carry `data_json`, plus `assets[]` and `resources[]`. */
export const projectRead = projectEntry as unknown as MarvinEntry;
export const referenceRead = referenceEntry as unknown as MarvinEntry;

export const marvinSite = sitePayload as unknown as MarvinSite;

/** `client.entry()` hands back the SDK's `Entry` wrapper, not the raw payload. */
export function asEntry(raw: MarvinEntry): Entry {
  return new Entry(raw);
}

export function fakeAsset(slug: string, publicUrl: string): MarvinAsset {
  return { slug, name: slug, publicUrl } as unknown as MarvinAsset;
}
