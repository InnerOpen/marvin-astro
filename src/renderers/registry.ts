import type {
  RendererDefinition,
  RendererPackage,
  RendererPackageOptions,
  RendererPackageRegistry,
  RendererRegistry,
} from './types.js';

/**
 * The renderer-package name Marvin's system entry types declare (`renderingJson.package`). The
 * core renderers moved into `@inneropen/marvin-astro`, but existing workspaces still name the old
 * package, so both identify the core set.
 */
export const CORE_RENDERER_PACKAGE = '@inneropen/marvin-renderers-core';
export const CORE_RENDERER_PACKAGES: readonly string[] = [
  CORE_RENDERER_PACKAGE,
  '@inneropen/marvin-astro',
];

export function isCoreRendererPackage(packageName: string | null | undefined): boolean {
  return Boolean(packageName) && CORE_RENDERER_PACKAGES.includes(packageName as string);
}

function isRendererRegistry<T>(value: RendererRegistry<T> | Record<string, T> | undefined): value is RendererRegistry<T> {
  return Boolean(value) && typeof value === 'object' && 'get' in value && typeof value.get === 'function';
}

export function resolveRenderer<T>(
  name: string,
  customRegistry?: RendererRegistry<T> | Record<string, T>,
  fallbackRegistry?: RendererRegistry<T> | Record<string, T>,
): T | undefined {
  const getValue = (registry: RendererRegistry<T> | Record<string, T> | undefined) => {
    if (!registry) return undefined;
    if (isRendererRegistry(registry)) {
      return registry.get(name);
    }
    return registry[name];
  };

  return getValue(customRegistry) ?? getValue(fallbackRegistry);
}

export function createRegistry<T>(
  map: Record<string, T>,
): RendererRegistry<T> {
  const registryMap = { ...map };

  const instance: RendererRegistry<T> = {
    get(name: string): T | undefined {
      return registryMap[name];
    },
    has(name: string): boolean {
      return name in registryMap;
    },
    names(): string[] {
      return Object.keys(registryMap);
    },
    use(packageDefinition: RendererPackage<T>): RendererRegistry<T> {
      for (const [name, value] of Object.entries(packageDefinition.registry.names().reduce<Record<string, T>>((acc, item) => {
        acc[item] = packageDefinition.registry.get(item)!;
        return acc;
      }, {}))) {
        if (!registryMap[name]) {
          registryMap[name] = value;
        }
      }
      return instance;
    },
    register(definition: RendererDefinition<T>): RendererRegistry<T> {
      if (registryMap[definition.key]) {
        throw new Error(`Duplicate renderer registration for "${definition.key}"`);
      }
      registryMap[definition.key] = definition.component;
      return instance;
    },
    override(overrides: Record<string, T>): RendererRegistry<T> {
      for (const [name, value] of Object.entries(overrides)) {
        registryMap[name] = value;
      }
      return instance;
    },
  };

  return instance;
}

export function createRendererPackage<T>(
  options: RendererPackageOptions<T>,
): RendererPackage<T> {
  return {
    packageName: options.packageName,
    version: options.version,
    registry: createRegistry(options.renderers),
  };
}

export function createPackageRegistry<T>(
  packages: RendererPackage<T>[],
): RendererPackageRegistry<T> {
  const byPackage = new Map(packages.map((item) => [item.packageName, item]));

  function getPackage(packageName: string): RendererPackage<T> | undefined {
    return byPackage.get(packageName);
  }

  function findLocalRenderer(name: string): T | undefined {
    for (const item of packages) {
      const renderer = item.registry.get(name);
      if (renderer) return renderer;
    }
    return undefined;
  }

  return {
    get(name: string, packageName?: string | null): T | undefined {
      if (packageName) {
        return getPackage(packageName)?.registry.get(name);
      }
      return findLocalRenderer(name);
    },
    has(name: string, packageName?: string | null): boolean {
      return Boolean(this.get(name, packageName));
    },
    names(): string[] {
      return packages.flatMap((item) => item.registry.names());
    },
    packages(): RendererPackage<T>[] {
      return packages;
    },
    getPackage,
  };
}
