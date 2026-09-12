# @inneropen/marvin-astro

Site integration for [Marvin CMS](https://github.com/inneropen) on Astro: content repositories
with static fallbacks, site chrome from collections, and payload normalization.

Three packages, three concerns:

| Package | Concern |
|---|---|
| `@inneropen/marvin-sdk` | transport — HTTP client, entries, collections, assets |
| `@inneropen/marvin-renderers-core` | entry-type → Astro renderer component mapping |
| **`@inneropen/marvin-astro`** | **site integration — repositories, chrome, normalization** |

A new site wires up to a Marvin workspace by installing one package, setting three env vars, and
writing only its own transform functions.

```bash
npm install @inneropen/marvin-astro @inneropen/marvin-sdk
```

```bash
MARVIN_API_URL=https://marvin.example.com
MARVIN_SITE_CLIENT_TOKEN=site_client_…
MARVIN_WORKSPACE_SLUG=my-workspace
```

## Quick start

```ts
// src/lib/content.ts
import { createMarvinContent } from '@inneropen/marvin-astro';
import { site as staticSite, mainNav, footerNav } from '../data/site';
import { posts as staticPosts } from '../data/posts';

export const marvin = createMarvinContent({
  site: { fallback: staticSite },
  chrome: { fallback: { mainNavigation: mainNav, footerNavigation: footerNav } },
});

const CATEGORIES = ['Making', 'Materials', 'Lessons'] as const;

export const posts = marvin.repository({
  collections: ['bench-notes', 'journal', 'blog'],   // tried in order
  hydrate: true,                                      // list items lack data_json — see below
  href: (slug) => `/bench-notes/${slug}`,
  fallback: () => staticPosts,
  sort: (a, b) => Date.parse(b.date) - Date.parse(a.date),
  transform: async (entry, f) => ({
    slug: entry.slug,
    title: entry.title ?? 'Untitled',
    date: f.string('date') ?? f.publishedAt() ?? '',
    noteNumber: f.string('noteNumber'),               // data_json → metadata_json
    category: f.oneOf('category', CATEGORIES, 'Making'),
    order: f.number('order') ?? 0,
    featured: f.bool('featured'),
    bodyHtml: await f.markdown('body'),
    image: f.image({ roles: ['hero', 'featured', 'card'] }),
    icon: f.icon(),
    href: f.href,
  }),
});
```

```astro
---
// src/pages/bench-notes/index.astro
import { posts, marvin } from '../../lib/content';

const all = await posts.all();
const { site, mainNavigation } = await marvin.getSiteChrome();
---
```

`posts.all()` · `posts.bySlug(slug)` · `posts.featured()` · `posts.allFeatured()` · `posts.reset()`

`bySlug` serves from the loaded list once `all()` has resolved — no extra request per detail
page — and only fetches the entry directly when nothing is loaded yet or the slug isn't in it.

## Why `hydrate`

The collection endpoint returns `PublishedEntryListItem`, which carries core fields and
`metadata_json` but **not** `data_json`. The single-entry endpoint returns `PublishedEntryRead`,
which includes it.

So if a transform reads any schema-defined field — anything beyond title/slug/summary/metadata —
`hydrate: true` is required or those fields come back `undefined`. It costs one request per entry.

Those requests run at most `hydrateConcurrency` at a time (default 6) rather than all at once, and
a read that fails is retried with backoff (3 attempts) before the entry is dropped, so a single
transient failure neither loses an item nor latches the backend off for the rest of the build.

```ts
createMarvinContent({ hydrateConcurrency: 4 });
```

## Field precedence

Every reader on `f` resolves `data_json` first and `metadata_json` second. An empty string counts
as absent: an entry type that declares a field the author left blank stores `""`, and without the
fall-through a legacy value that *is* set would never surface.

| | |
|---|---|
| `f.string(key)` `f.number(key)` `f.bool(key)` `f.list(key)` | scalars; `bool` reads `"true"`/`"1"`/`"yes"` |
| `f.oneOf(key, allowed, fallback)` | enum guard — replaces per-field `normalizeStatus`-style helpers |
| `f.raw(key)` `f.data()` `f.metadata()` | untyped escape hatches |
| `f.markdown(key?, { softBreaks })` | renders to HTML; `undefined` when there is nothing to render |
| `f.date(key)` `f.publishedAt()` | display date ("Mon DD, YYYY") / raw ISO stamp |
| `f.image(options)` `f.images(options)` `f.icon(options)` | resolved `{src, alt, focalPoint}` |
| `f.asset(options)` `f.assetByRole(...roles)` `f.assets()` | raw asset placements |
| `f.resource(options)` `f.resources(options)` | attached resources → `{name, type, role, href}` |
| `f.collections()` `f.role(collection)` `f.href` | membership and routing context |

`f.image()` checks, in order: a hand-authored `metadata_json.featuredImage`, the exact
`preferRoles` (for derived variants like a colour-graded hero), a role/usage match over the
entry's image assets, then the list item's `featuredAsset`.

> **Role matching:** `selectEntryAsset` ORs role against usage, and an absent usage criterion is
> vacuously true — so a role-only query matches the entry's *first* asset. When you mean "the
> asset whose role is exactly this", use `f.assetByRole()` / `selectAssetByRole()`.

## Site and chrome

```ts
const site = await marvin.getSite();       // identity, SEO, brand assets — memoized
const chrome = await marvin.getSiteChrome(); // nav, footer, legal, social, inquiry — memoized
```

`getSite()` resolves every `site_metadata_json.brand.<name>` asset slug to a URL in one pass, so
a site adds a shared brand asset with one config line and reads `site.brand.<name>` — no code
change per asset. `logo`, `favicon` and `seal` are aliased onto the top level.

`getSiteChrome()` reads `main-navigation` and `footer-navigation` collections, splits
`role: 'legal'` entries into `legalLinks`, and groups the rest into footer columns. A nav entry's
route comes from an explicit `href`/`url`/`path` field if it has one, otherwise from
`resolveHref`:

```ts
resolveHref?: (entry, context) => string
```

The default prefixes the entry's own non-navigation collection: an entry in `workshop-reference`
becomes `/workshop-reference/<slug>`, an entry in no other collection becomes `/<slug>`. Override
when routes don't mirror collections.

## The failure latch

A static build asks for content once per path. When the backend is down that means N failed
requests with N timeouts. The latch trips on the first *network* failure — not a 404, which says
nothing about the next entry — and short-circuits the rest.

It expires after `retryAfterMs`, so a dev server recovers on its own when the backend comes back
instead of serving stale static data until someone restarts it. Defaults: **30s in dev**,
**`Infinity` in production**, since a build should fail fast and consistently rather than
half-succeed with some pages live and some static.

```ts
createMarvinContent({ retryAfterMs: 5_000 });
marvin.backend.isLatched();
marvin.backend.clearLatch();
```

## SEO head (optional)

One component ships, behind its own export path, so the core package stays pure TypeScript and
Astro stays an optional peer dependency.

```astro
---
import { SeoHead } from '@inneropen/marvin-astro/astro';
import { marvin } from '../lib/content';

const { seo } = await marvin.getSite();
---
<head>
  <SeoHead {seo} pageTitle="Bench Notes" pageType="article" />
</head>
```

It emits title, description, robots, canonical, Open Graph, Twitter and search-engine
verification tags. No styling, no site coupling.

## Exports

| Path | Contents |
|---|---|
| `@inneropen/marvin-astro` | `createMarvinContent` and every helper below it |
| `@inneropen/marvin-astro/types` | resolved types only (`ApiSite`, `ApiSeo`, `ApiSiteChrome`, …) |
| `@inneropen/marvin-astro/astro` | `SeoHead` |

Beyond `createMarvinContent`, the pieces are usable on their own: `createBackend`,
`createFetcher`, `createRepository`, `createSiteLoader`, `createChromeLoader`,
`createFieldAccessor`, `createMarkdownRenderer`, `formatDisplayDate`, `selectValuesForPage`, and
the whole `normalize` surface.

## Development

```bash
npm install
npm run typecheck
npm test          # vitest, fixture-driven, no network
npm run build     # tsup → dist/ with .d.ts
```

Fixtures under `tests/fixtures/` are captured from a live workspace rather than hand-written —
payload-shape drift is the class of bug they exist to catch.

Two live checks need a running Marvin (`MARVIN_*` in the environment):

```bash
# End-to-end wiring: env, auth, chrome, a repository, one entry.
npx vite-node examples/smoke.ts [collection-slug]

# Field-level diff against a site's existing hand-rolled integration.
npx vite-node -c examples/parity/vite.config.ts examples/parity/mashandburnco.ts
```

## License

MIT
