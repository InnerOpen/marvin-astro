# [2.2.0](https://github.com/InnerOpen/marvin-astro/compare/v2.1.1...v2.2.0) (2026-10-22)


### Features

* requireBackend fails a deploy build instead of publishing the static fallbacks ([b9ef0c4](https://github.com/InnerOpen/marvin-astro/commit/b9ef0c4895dda0b9d53825ba42b06376ad21e628))

## [2.1.1](https://github.com/InnerOpen/marvin-astro/compare/v2.1.0...v2.1.1) (2026-10-19)


### Bug Fixes

* privacy tables wrap at word boundaries; only long tokens break ([27a115c](https://github.com/InnerOpen/marvin-astro/commit/27a115c90c33bf5575d99c0adcc9bc9482b89df9))

# [2.1.0](https://github.com/InnerOpen/marvin-astro/compare/v2.0.0...v2.1.0) (2026-10-19)


### Bug Fixes

* equal-width consent buttons that stack full-width on mobile ([5315c70](https://github.com/InnerOpen/marvin-astro/commit/5315c703cde31c8f8fa96e3174c7aa0050ddea54))
* inline consent.css where the banner renders ([5082df9](https://github.com/InnerOpen/marvin-astro/commit/5082df9e9f227ce228c9ebdbf7b9e2c6c2c0af2b))


### Features

* consent banner with a zero-import consent runtime ([676d02c](https://github.com/InnerOpen/marvin-astro/commit/676d02c204829d9d8764df77bf70cd8eba2c3812))
* render site.privacy with PrivacyPolicy, CookieTable and ProcessorTable ([d039ef0](https://github.com/InnerOpen/marvin-astro/commit/d039ef01858fc74bd072d029ae457b52953aca6d))

# [2.0.0](https://github.com/InnerOpen/marvin-astro/compare/v1.4.0...v2.0.0) (2026-10-18)


* feat!: drop asset and resource fetchers and site asset-slug resolution ([32c796a](https://github.com/InnerOpen/marvin-astro/commit/32c796a23bbe0004c93d179fa4d70e7bb7532f60))


### BREAKING CHANGES

* fetcher.assets(), fetcher.asset() and fetcher.resources() are removed
(marvin.fetch.*). getSite() no longer looks up asset slugs for logo, favicon, seo.image or
metadata.brand.*: logo, favicon and seo.image are used as returned, and site.brand now holds
only brand values that are already URLs, root-relative paths or data URIs. Bare brand slugs
are left out.

# [1.4.0](https://github.com/InnerOpen/marvin-astro/compare/v1.3.0...v1.4.0) (2026-10-08)


### Features

* one build-time "is Marvin up?" check decides every fallback ([0e16ff5](https://github.com/InnerOpen/marvin-astro/commit/0e16ff5ccea95929bc9c5e5192b1a3b450db2366))

# [1.3.0](https://github.com/InnerOpen/marvin-astro/compare/v1.2.2...v1.3.0) (2026-10-08)


### Features

* **chrome:** emptied collections render nothing; social links from a collection ([321f3ef](https://github.com/InnerOpen/marvin-astro/commit/321f3ef0ccc599f1524f053275737632f059e4d7))

## [1.2.2](https://github.com/InnerOpen/marvin-astro/compare/v1.2.1...v1.2.2) (2026-10-05)


### Performance Improvements

* request hydrated lists with expand=full ([ae65a90](https://github.com/InnerOpen/marvin-astro/commit/ae65a9015fff3b270f33dea4a1bf23e0d1a91bd8))

## [1.2.1](https://github.com/InnerOpen/marvin-astro/compare/v1.2.0...v1.2.1) (2026-10-05)


### Bug Fixes

* hydrate list items that carry data; bySlug serves only full entries ([e591146](https://github.com/InnerOpen/marvin-astro/commit/e5911468971c6d8e1e7b35c4ad0556907c318459))

# [1.2.0](https://github.com/InnerOpen/marvin-astro/compare/v1.1.1...v1.2.0) (2026-10-05)


### Bug Fixes

* **embeds:** match the markup and null fields Marvin actually publishes ([8b9ca0c](https://github.com/InnerOpen/marvin-astro/commit/8b9ca0c895ada3192dde47b9c57c68696cab00b6))


### Features

* **components:** fold in the renderers-core components; add Embed, LinkCard, EmbedLoader ([9e2b8de](https://github.com/InnerOpen/marvin-astro/commit/9e2b8de88a4697c7ca935b3c07b3628cba9d6285))
* render media embeds from markdown and embed fields ([94e5e91](https://github.com/InnerOpen/marvin-astro/commit/94e5e91c19024b473c8d59cb20a1533767110bd3))

## [1.1.1](https://github.com/inneropen/marvin-astro/compare/v1.1.0...v1.1.1) (2026-09-12)


### Performance Improvements

* serve bySlug from the loaded list; bounded, retrying hydrate ([dacbd94](https://github.com/inneropen/marvin-astro/commit/dacbd94185abd2bbc786431135871f70d0b85b97))

# [1.1.0](https://github.com/inneropen/marvin-astro/compare/v1.0.0...v1.1.0) (2026-07-26)


### Features

* **site:** resolve top-level logo/favicon asset slugs ([080162c](https://github.com/inneropen/marvin-astro/commit/080162cbfba6a0e61a5d9ca9b3f6511fba252662))

# 1.0.0-next.1 (2026-07-26)


### Features

* generalized Marvin→Astro site integration package ([4f04444](https://github.com/inneropen/marvin-astro/commit/4f04444ea58673da9fc278dfa2cdea50643c7073))
* **site:** resolve top-level logo/favicon asset slugs ([080162c](https://github.com/inneropen/marvin-astro/commit/080162cbfba6a0e61a5d9ca9b3f6511fba252662))
