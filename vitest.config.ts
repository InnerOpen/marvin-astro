/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// Astro's Vite config compiles `.astro` files, so component tests can render them through the
// Container API. The package has no pages; keep Astro from warning about that on every run.
export default getViteConfig({ test: {} }, { logLevel: 'error', devToolbar: { enabled: false } });
