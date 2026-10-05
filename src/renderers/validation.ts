import type { RendererRegistry } from './types.js';
import type { MissingRenderer, ValidationResult } from './validation-types.js';

interface EntryTypeWithRendering {
  slug: string;
  name: string;
  isRendered?: boolean;
  rendering?: Record<string, unknown> | null;
}

function isRendererRegistry(value: unknown): value is RendererRegistry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RendererRegistry).has === 'function'
  );
}

export function validateRenderers(
  entryTypes: EntryTypeWithRendering[],
  registry: RendererRegistry | Record<string, unknown>,
  options?: { ignore?: string[] }
): ValidationResult {
  const ignore = new Set(options?.ignore ?? []);

  const withRenderer = entryTypes.filter(
    (et) => et.isRendered && et.rendering?.renderer && !ignore.has(et.slug)
  );

  const hasRenderer = isRendererRegistry(registry)
    ? (name: string) => registry.has(name)
    : (name: string) => name in registry;

  const missing: MissingRenderer[] = [];

  for (const et of withRenderer) {
    const rendering = et.rendering!;
    const renderer = rendering.renderer as string;
    if (!hasRenderer(renderer)) {
      missing.push({
        entryTypeSlug: et.slug,
        entryTypeName: et.name,
        renderer,
        package: (rendering.package as string) ?? undefined,
        version: (rendering.version as string) ?? undefined,
      });
    }
  }

  return {
    total: withRenderer.length,
    covered: withRenderer.length - missing.length,
    missing,
  };
}
