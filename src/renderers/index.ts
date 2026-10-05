/**
 * `@inneropen/marvin-astro/renderers` — framework-agnostic renderer logic: resolve an entry's
 * renderer, build registries, and validate a registry against a workspace's entry types.
 * (Formerly `@inneropen/marvin-renderers-core/logic`.) The Astro components live in
 * `@inneropen/marvin-astro/components`.
 */

export type {
  CoreRendererName,
  EntryTypeInfo,
  RendererEntry,
  RendererPackage,
  RendererPackageOptions,
  RendererPackageRegistry,
  RendererProps,
  RendererRegistry,
} from './types.js';

export {
  resolveRendererName,
  resolveRendererRequirement,
  resolveRendererConfig,
  extractBody,
  extractField,
  getFeaturedAsset,
  isRoutable,
  shouldRenderEntry,
} from './resolve.js';

export {
  CORE_RENDERER_PACKAGE,
  CORE_RENDERER_PACKAGES,
  isCoreRendererPackage,
  createPackageRegistry,
  createRegistry,
  createRendererPackage,
  resolveRenderer,
} from './registry.js';

export type {
  MissingRenderer,
  RendererCheckOptions,
  ValidationResult,
} from './validation-types.js';

export { validateRenderers } from './validation.js';

export { debug } from './debug.js';
