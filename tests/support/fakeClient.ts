/**
 * An in-memory stand-in for the SDK client, injected through the `createClient` seam. Lets the
 * repository/chrome/site tests run the real code paths — including the guarded catch blocks —
 * with zero network.
 */

import { Entry } from '@inneropen/marvin-sdk';
import type { MarvinAsset, MarvinEntry, MarvinSite } from '@inneropen/marvin-sdk';
import { asEntry } from './fixtures.js';

export type FakeClientSetup = {
  /** Collection slug → the entries that collection returns. */
  collections?: Record<string, unknown[]>;
  /** Entry slug → the full read for that entry. */
  entries?: Record<string, MarvinEntry>;
  site?: MarvinSite | null;
  assets?: Record<string, MarvinAsset>;
  /** Throw this on every call — use a network-shaped message to exercise the latch. */
  throws?: Error;
};

export type FakeClient = {
  client: unknown;
  /** How many times each method was called, keyed `"<method>:<arg>"`. */
  calls: string[];
  countOf(prefix: string): number;
};

export function createFakeClient(setup: FakeClientSetup = {}): FakeClient {
  const calls: string[] = [];

  function record<T>(label: string, value: () => T): T {
    calls.push(label);
    if (setup.throws) throw setup.throws;
    return value();
  }

  const client = {
    collections: {
      list: async () =>
        record('collections.list', () =>
          Object.keys(setup.collections ?? {}).map((slug) => ({ slug, name: slug }))
        ),
      get: async (slug: string) =>
        record(`collections.get:${slug}`, () => ({ slug, entries: setup.collections?.[slug] ?? [] })),
      entries: async (slug: string) =>
        record(`collections.entries:${slug}`, () => setup.collections?.[slug] ?? []),
    },
    entry: async (slug: string): Promise<Entry | null> =>
      record(`entry:${slug}`, () => {
        const raw = setup.entries?.[slug];
        return raw ? asEntry(raw) : null;
      }),
    getSite: async () => record('getSite', () => setup.site ?? null),
    getWorkspace: async () => record('getWorkspace', () => ({})),
    assets: {
      list: async () => record('assets.list', () => Object.values(setup.assets ?? {})),
      get: async (slugOrId: string) =>
        record(`assets.get:${slugOrId}`, () => setup.assets?.[slugOrId] ?? null),
    },
    resources: {
      list: async () => record('resources.list', () => []),
    },
  };

  return {
    client,
    calls,
    countOf: (prefix: string) => calls.filter((call) => call.startsWith(prefix)).length,
  };
}

/** An error shaped like the SDK's transport failure, so the latch recognizes it. */
export function networkError(): Error {
  return new Error('Network error: fetch failed');
}

/** Silences the package's `console.warn` chatter during expected-failure tests. */
export const quietLogger = {
  log: () => {},
  warn: () => {},
  error: () => {},
};
