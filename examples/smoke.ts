/**
 * Live smoke test — runs against a real Marvin workspace and prints what it resolved.
 *
 * The unit tests prove the logic against captured fixtures; this proves the wiring against a
 * running backend: env resolution, auth, the SDK client, chrome, a repository, and one entry.
 *
 *   MARVIN_API_URL=http://localhost:8080 \
 *   MARVIN_SITE_CLIENT_TOKEN=site_client_… \
 *   MARVIN_WORKSPACE_SLUG=my-workspace \
 *   npx tsx examples/smoke.ts [collection-slug]
 *
 * Exits non-zero if the backend is unreachable or the workspace has no content.
 */

import { createMarvinContent } from '../src/index.js';

type SmokeItem = {
  slug: string;
  title: string;
  href?: string;
  summary?: string;
  order: number;
  featured: boolean;
  image?: string;
  icon?: string;
  bodyChars: number;
};

const collectionSlug = process.argv[2] ?? 'workshop-reference';

const marvin = createMarvinContent({
  site: { fallback: { name: 'Smoke test site' } },
});

const items = marvin.repository<SmokeItem>({
  collection: collectionSlug,
  hydrate: true,
  href: (slug) => `/${collectionSlug}/${slug}`,
  sort: (a, b) => a.order - b.order,
  transform: async (entry, f) => ({
    slug: entry.slug ?? '',
    title: entry.title ?? 'Untitled',
    href: f.href,
    summary: entry.summary ?? undefined,
    order: f.number('order') ?? 0,
    featured: f.bool('featured'),
    image: f.image()?.src,
    icon: f.icon({ fallbackToFeatured: true }),
    bodyChars: (await f.markdown('body'))?.length ?? 0,
  }),
});

function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

async function main(): Promise<number> {
  heading('Configuration');
  console.log({
    apiUrl: marvin.config.apiUrl || '(missing)',
    workspaceSlug: marvin.config.workspaceSlug || '(missing)',
    tokenPresent: Boolean(marvin.config.siteClientToken),
    retryAfterMs: marvin.config.retryAfterMs,
  });

  if (!marvin.hasBackend()) {
    console.error('\nNo Marvin backend configured. Set MARVIN_API_URL, MARVIN_SITE_CLIENT_TOKEN, MARVIN_WORKSPACE_SLUG.');
    return 1;
  }

  heading('Collections');
  const collections = await marvin.fetch.collections();
  console.log(collections.map((collection) => collection.slug).join(', ') || '(none)');

  if (marvin.backend.isLatched()) {
    console.error('\nBackend unreachable — the failure latch engaged.');
    return 1;
  }

  heading('Site');
  const site = await marvin.getSite();
  console.log({
    title: site.title,
    workspace: site.workspaceSlug,
    locale: site.locale,
    timezone: site.timezone,
    brandAssets: Object.keys(site.brand ?? {}).length,
    ogImage: site.seo.image,
    titleTemplate: site.seo.titleTemplate,
  });

  heading('Chrome');
  const chrome = await marvin.getSiteChrome();
  console.log({
    mainNavigation: chrome.mainNavigation.map((link) => `${link.label} → ${link.href}`),
    footerColumns: chrome.footerNavigation.map((column) => column.map((link) => link.label)),
    legalLinks: chrome.legalLinks.map((link) => `${link.label} → ${link.href}`),
    socialLinks: chrome.socialLinks.map((link) => link.icon),
  });

  heading(`Repository: ${collectionSlug}`);
  const all = await items.all();
  console.table(
    all.map((item) => ({
      slug: item.slug,
      title: item.title,
      href: item.href,
      order: item.order,
      body: item.bodyChars,
      image: item.image ? 'yes' : '—',
      icon: item.icon ? 'yes' : '—',
    }))
  );

  if (all.length === 0) {
    console.error(`\nCollection "${collectionSlug}" returned no entries.`);
    return 1;
  }

  heading('Single entry (bySlug)');
  const first = await items.bySlug(all[0].slug);
  console.log(first);

  heading('Section landing');
  console.log(await marvin.getSectionLanding(collectionSlug));

  console.log('\n\x1b[32mSmoke test passed.\x1b[0m');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
