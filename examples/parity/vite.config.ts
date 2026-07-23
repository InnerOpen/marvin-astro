import { defineConfig } from 'vite';

const SITE_ROOT = process.env.SITE_ROOT ?? '/home/jared/code/mashandburnco';

// TEMPORARY: config for the parity harness only.
// - fs.allow lets it import mashandburnco's modules from outside this repo.
// - envDir + envPrefix reproduce how Astro exposes MARVIN_* on import.meta.env, which is what
//   mashandburnco's client reads. Without it the site half silently serves static data and the
//   comparison is meaningless.
export default defineConfig({
  envDir: SITE_ROOT,
  envPrefix: ['MARVIN_'],
  server: {
    fs: { allow: [SITE_ROOT, process.cwd()], strict: false },
  },
});
