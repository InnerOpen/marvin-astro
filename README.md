# @inneropen/marvin-astro

Site integration for [Marvin CMS](https://github.com/inneropen) on Astro: content repositories
with static fallbacks, site chrome from collections, and payload normalization.

Two packages, two concerns:

| Package | Concern |
|---|---|
| `@inneropen/marvin-sdk` | transport — HTTP client, entries, collections, assets |
| **`@inneropen/marvin-astro`** | **site integration — repositories, chrome, normalization, and the Astro components (forms, media embeds, entry-type renderers)** |

`@inneropen/marvin-renderers-core` has been folded in here — see
[Migrating from @inneropen/marvin-renderers-core](#migrating-from-inneropenmarvin-renderers-core).

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

The collection endpoint returns `PublishedEntryListItem`: core fields, `metadata_json` and (on
current servers) `data`, but only the *slugs* of its assets and resources — no `assets[]`
placements (so no roles, no `hero-grade` image) and no `resources[]`. The single-entry endpoint
returns `PublishedEntryRead`, which has all of it.

So if a transform reads asset roles, resources, or (on an older server, whose list items lack
`data`) any schema field, `hydrate: true` is required. A hydrated list is requested with
`expand=full`, and a Marvin server that supports it returns every entry in full in that one
request (this needs `@inneropen/marvin-sdk` 4.2 or later; older SDKs drop the option). Against an
older server or SDK the list comes back as list items, and hydrating costs one more request per
entry. Items are re-read unless they're already full entries (`isFullEntry`: `assets[]`/`resources[]`
present, no `assetSlugs`) — carrying `data` isn't enough. `bySlug()` serves a detail page from the
loaded list only when that item came from a full entry; otherwise it fetches the entry.

Those per-entry requests run at most `hydrateConcurrency` at a time (default 6) rather than all at once, and
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
| `f.markdown(key?, { softBreaks, embeds })` | renders to HTML, with [media embeds](#media-embeds); `undefined` when there is nothing to render |
| `f.embed(key)` | the resolved embed for an `embed` field — render with `<Embed>` |
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

## Media embeds

Paste a YouTube, Vimeo, Spotify, SoundCloud, Apple Music/Podcasts, Tidal or podcast link on its
own line in a markdown field and Marvin resolves it on the server. The published entry then
carries `embeds`, keyed by the URL exactly as written, each with Marvin-built `html` for the
site's embed mode and the structured fields behind it. The stored markdown never changes, so a
site that doesn't render embeds just shows the link.

**Markdown.** `f.markdown()` passes the entry's embeds automatically. A paragraph that is exactly
a URL with an `embeds` entry renders as that embed's `html`; `<url>`, `[text](url)`, a URL inside
a sentence and anything in code stay as they are. Opt a field out with `f.markdown('body',
{ embeds: false })`. Where you call the renderer yourself, pass the embeds:

```ts
import { entryEmbeds } from '@inneropen/marvin-astro';

const bodyHtml = await marvin.renderMarkdown(body, { embeds: entryEmbeds(entry) });
```

**`embed` fields.** An `embed` field's value is the provider URL; `f.embed(key)` returns its
resolved embed. Render it with `<Embed>`, which builds the player, facade or link card from the
structured fields:

```astro
---
import { Embed } from '@inneropen/marvin-astro/components';
const site = await marvin.getSite();
---
<Embed
  embed={post.video}
  mode={site.embeds?.mode}
  consentText={site.embeds?.consentText}
  frameSources={site.embeds?.frameSources}
/>
```

**The loader and CSS.** In `click_to_load` mode (Marvin's default) an embed is a facade — a
button and a plain link — and nothing loads from the provider until the visitor clicks. Put
`<EmbedLoader />` once in your layout:

```astro
---
import { EmbedLoader } from '@inneropen/marvin-astro/components';
---
<body>
  <slot />
  <EmbedLoader />
</body>
```

On click (or Enter/Space) it swaps the button for the iframe. It builds the iframe only from the
facade's `data-marvin-embed-attrs`, keeps only `src`, `title`, `allow`, `sandbox`,
`referrerpolicy`, `loading` and `style`, refuses any `src` that isn't https on a host in
`data-marvin-embed-hosts`, and never parses HTML. It also brings the base `.marvin-embed` CSS:
responsive aspect ratio for video, fixed height for audio, facade and link-card styles. The
rules have zero specificity, so any site rule wins; theme through custom properties:

```css
.marvin-embed, .marvin-embed-link {
  --marvin-embed-radius: 0;
  --marvin-embed-bg: var(--ink);
  --marvin-embed-fg: var(--paper);
  --marvin-embed-max-width: 48rem;
}
```

The full list (`--marvin-embed-aspect`, `-height`, `-margin`, `-muted`, `-border`, `-focus`, …)
is at the top of `src/components/embeds.css`. For CSS without the loader (a `direct`-mode site),
`import '@inneropen/marvin-astro/components/embeds.css'`.

**CSP.** `site.embeds.frameSources` lists every origin the site's embeds may frame. Use it for a
`frame-src` directive:

```astro
---
const site = await marvin.getSite();
const frameSrc = ["'self'", ...(site.embeds?.frameSources ?? [])].join(' ');
---
<meta http-equiv="Content-Security-Policy" content={`frame-src ${frameSrc}`} />
```

The loader script is small enough that Astro inlines it; if your CSP forbids inline scripts, hash
it or set `vite.build.assetsInlineLimit: 0` so Astro emits it as a file.

The embed types (`MarvinEmbed`, `MarvinSiteEmbeds`, …) are declared in this package, so none of
this needs a newer SDK.

## Components

`@inneropen/marvin-astro/components` ships Astro source, compiled by your site's build.

| Component | Use |
|---|---|
| `FormRenderer` | a public form from a submittable entry type's `formSchema`; unstyled, progressive-enhancement submit |
| `Embed`, `LinkCard`, `EmbedLoader` | media embeds (above) |
| `EntryRenderer` | picks the renderer for an entry from its entry type's `rendering` |
| `PageRenderer`, `ArticleRenderer`, `FaqRenderer`, `NavigationRenderer` | unstyled, semantic core renderers with `data-renderer`/`data-role` hooks |

Page and Article render the markdown body (with embeds); pass `renderMarkdown={marvin.renderMarkdown}`
to use your site's markdown options.

The registry and logic: `getRenderer`, `astroRegistry`, `coreRendererPackage` from
`@inneropen/marvin-astro/components` (or `/components/registry`), and the framework-agnostic
helpers — `resolveRendererName`, `resolveRendererConfig`, `extractBody`, `extractField`,
`getFeaturedAsset`, `createRegistry`, `createPackageRegistry`, `createRendererPackage`,
`validateRenderers`, … — from `@inneropen/marvin-astro/renderers`.

Build-time check that every rendered entry type has a renderer:

```js
// astro.config.mjs
import { marvinIntegration } from '@inneropen/marvin-astro/components/integration';
import { astroRegistry } from '@inneropen/marvin-astro/components/registry';

export default defineConfig({
  integrations: [marvinIntegration({ registry: astroRegistry })],
});
```

Options: `registry` (required), `apiUrl`, `siteToken` (default to the `MARVIN_*` env vars),
`strict` (throw instead of warn), `ignore` (entry-type slugs to skip).

Marvin's system entry types name their renderer package `@inneropen/marvin-renderers-core`; the
core renderers still answer to that name (and to `@inneropen/marvin-astro`).

## Migrating from @inneropen/marvin-renderers-core

The components and logic moved here with their names unchanged. Swap the import paths, then
remove `@inneropen/marvin-renderers-core` from `package.json`:

| Before (`@inneropen/marvin-renderers-core…`) | After (`@inneropen/marvin-astro…`) |
|---|---|
| `/astro` | `/components` |
| `/astro/registry` | `/components/registry` |
| `/astro/integration` | `/components/integration` |
| `/astro/renderers/PageRenderer.astro` (etc.) | `/components/renderers/PageRenderer.astro` |
| `/logic` | `/renderers` |

```diff
-import { FormRenderer } from '@inneropen/marvin-renderers-core/astro';
+import { FormRenderer } from '@inneropen/marvin-astro/components';
```

Behaviour changes: Page/Article now render the body as markdown instead of injecting it raw, and
`EntryRenderer` renders core entry types without a custom registry (it silently rendered only
its slot before).

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

`SeoHead` ships behind its own export path (as do the [components](#components)), so the core
package stays pure TypeScript and Astro stays an optional peer dependency.

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
| `@inneropen/marvin-astro/components` | `FormRenderer`, `Embed`, `LinkCard`, `EmbedLoader`, `EntryRenderer`, the core renderers, registry, `marvinIntegration` |
| `@inneropen/marvin-astro/components/registry` | `getRenderer`, `astroRegistry`, `coreRendererPackage` |
| `@inneropen/marvin-astro/components/integration` | `marvinIntegration` (for `astro.config.mjs`) |
| `@inneropen/marvin-astro/components/*` | individual components, `renderers/*.astro`, `embeds.css` |
| `@inneropen/marvin-astro/renderers` | renderer logic (compiled): resolve, registry, validation |

Beyond `createMarvinContent`, the pieces are usable on their own: `createBackend`,
`createFetcher`, `createRepository`, `createSiteLoader`, `createChromeLoader`,
`createFieldAccessor`, `createMarkdownRenderer`, `entryEmbeds`, `findEmbed`, `siteEmbeds`,
`formatDisplayDate`, `selectValuesForPage`, and the whole `normalize` surface.

## Development

```bash
npm install
npm run typecheck
npm test          # vitest, fixture-driven, no network; .astro components via Astro's Container API
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
