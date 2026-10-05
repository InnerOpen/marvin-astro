import type { AstroIntegration } from 'astro';
import { createMarvinClient } from '@inneropen/marvin-sdk';
import { validateRenderers } from '../renderers/validation.js';
import type { RendererCheckOptions } from '../renderers/validation-types.js';

/**
 * Build-time check that every rendered entry type in the workspace has a renderer in `registry`.
 * Import it from `@inneropen/marvin-astro/components/integration` in `astro.config.mjs` (that
 * path has no `.astro` imports, so the config loader can read it).
 */
export function marvinIntegration(options: RendererCheckOptions): AstroIntegration {
  const { registry, strict = false, ignore } = options;

  return {
    name: '@inneropen/marvin-astro/renderers',
    hooks: {
      'astro:config:done': async ({ logger }) => {
        const apiUrl = options.apiUrl || process.env.MARVIN_API_URL;
        const siteToken = options.siteToken || process.env.MARVIN_SITE_CLIENT_TOKEN;
        const workspaceSlug = process.env.MARVIN_WORKSPACE_SLUG;

        if (!apiUrl || !siteToken || !workspaceSlug) {
          logger.warn(
            'Skipping renderer validation — missing MARVIN_API_URL, MARVIN_SITE_CLIENT_TOKEN, or MARVIN_WORKSPACE_SLUG'
          );
          return;
        }

        let workspaceRenderers;
        try {
          const client = createMarvinClient({ apiUrl, siteClientToken: siteToken, workspaceSlug });
          workspaceRenderers = await client.renderers.list();
        } catch (error) {
          logger.warn(
            `Renderer validation failed — could not reach Marvin API: ${error instanceof Error ? error.message : error}`
          );
          return;
        }

        const result = validateRenderers(workspaceRenderers, registry, { ignore });

        if (result.missing.length === 0) {
          logger.info(
            `All ${result.total} entry type renderer(s) covered`
          );
          return;
        }

        const lines = result.missing.map(
          (m) => `  - "${m.renderer}" for entry type "${m.entryTypeName}" (${m.entryTypeSlug})`
        );
        const message = `Missing ${result.missing.length} renderer(s):\n${lines.join('\n')}`;

        if (strict) {
          throw new Error(message);
        }

        logger.warn(message);
      },
    },
  };
}
