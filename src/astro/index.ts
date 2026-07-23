/**
 * Optional Astro entry point.
 *
 * Kept behind its own export path so the core package stays pure TypeScript — a consumer that
 * only wants repositories and normalization never pulls Astro in.
 */

export { default as SeoHead } from './SeoHead.astro';
