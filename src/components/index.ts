/**
 * `@inneropen/marvin-astro/components` — Astro components for Marvin content (formerly
 * `@inneropen/marvin-renderers-core/astro`).
 *
 * Shipped as source and compiled by the consuming site's Astro build. For `astro.config.mjs`,
 * import `marvinIntegration` from `@inneropen/marvin-astro/components/integration` instead: this
 * entry pulls in `.astro` files.
 */

export {
  PageRenderer,
  ArticleRenderer,
  FaqRenderer,
  NavigationRenderer,
  astroRegistry,
  coreRendererPackage,
  getRenderer,
} from './registry.js';

export { default as EntryRenderer } from './EntryRenderer.astro';
export { default as FormRenderer } from './FormRenderer.astro';
export { default as Embed } from './Embed.astro';
export { default as LinkCard } from './LinkCard.astro';
export { default as EmbedLoader } from './EmbedLoader.astro';
export { marvinIntegration } from './integration.js';
export { iframeAttributes, installEmbedLoader, isAllowedFrameSrc } from './embed-frame.js';

// The framework-agnostic renderer logic, so one import covers a renderer component's needs.
export * from '../renderers/index.js';
