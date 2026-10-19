/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// Astro's Vite config compiles `.astro` files, so component tests can render them through the
// Container API. The package has no pages; keep Astro from warning about that on every run.
// consent.css is imported `?raw` and inlined by <ConsentBanner>; Vitest would otherwise stub it empty.
export default getViteConfig({ test: { css: { include: [/consent\.css/] } } }, { logLevel: 'error', devToolbar: { enabled: false } });
