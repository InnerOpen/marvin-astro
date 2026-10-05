import PageRenderer from './renderers/PageRenderer.astro';
import ArticleRenderer from './renderers/ArticleRenderer.astro';
import FaqRenderer from './renderers/FaqRenderer.astro';
import NavigationRenderer from './renderers/NavigationRenderer.astro';
import {
  CORE_RENDERER_PACKAGE,
  createRendererPackage,
  createRegistry,
} from '../renderers/registry.js';
import type { CoreRendererName } from '../renderers/types.js';
import packageJson from '../../package.json';

export { PageRenderer, ArticleRenderer, FaqRenderer, NavigationRenderer };

const rendererMap: Record<CoreRendererName, typeof PageRenderer> = {
  page: PageRenderer,
  article: ArticleRenderer,
  faq: FaqRenderer,
  navigation: NavigationRenderer,
};

export const astroRegistry = createRegistry(rendererMap);

// Named after the package Marvin's system entry types declare, so a package registry keyed by
// `renderingJson.package` still finds these renderers.
export const coreRendererPackage = createRendererPackage({
  packageName: CORE_RENDERER_PACKAGE,
  version: packageJson.version,
  renderers: rendererMap,
});

export function getRenderer(name: string) {
  return astroRegistry.get(name);
}
