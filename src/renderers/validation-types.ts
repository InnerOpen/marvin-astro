import type { RendererRegistry } from './types.js';

export interface RendererCheckOptions {
  registry: RendererRegistry | Record<string, unknown>;
  apiUrl?: string;
  siteToken?: string;
  strict?: boolean;
  ignore?: string[];
}

export interface MissingRenderer {
  entryTypeSlug: string;
  entryTypeName: string;
  renderer: string;
  package?: string;
  version?: string;
}

export interface ValidationResult {
  total: number;
  covered: number;
  missing: MissingRenderer[];
}
