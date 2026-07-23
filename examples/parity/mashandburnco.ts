/**
 * Parity harness — a migration aid, not part of the shipped package.
 *
 * Runs mashandburnco's existing hand-rolled repositories and the package's equivalents against
 * the SAME live workspace, then diffs field by field. Field-level equality is the bar: it is
 * what makes migrating that site later a mechanical change rather than a rewrite.
 *
 *   set -a && . /home/jared/code/mashandburnco/.env && set +a
 *   npx vite-node -c examples/parity/vite.config.ts examples/parity/mashandburnco.ts
 *
 * Point MARVIN_API_URL at a dead port to check the offline fallback paths instead.
 * Exits non-zero on any divergence. SITE_ROOT overrides where the site repo lives.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// mashandburnco reads connection settings off import.meta.env (Astro's server env). Under
// vite-node only VITE_-prefixed vars land there, so mirror them across before importing it.
const metaEnv = (import.meta as any).env as Record<string, string | undefined>;
for (const key of [
  'MARVIN_API_URL',
  'MARVIN_SITE_CLIENT_TOKEN',
  'MARVIN_WORKSPACE_SLUG',
  'MARVIN_DEBUG',
]) {
  metaEnv[key] = process.env[key];
}

const SITE_ROOT = process.env.SITE_ROOT ?? '/home/jared/code/mashandburnco';
const SITE = `${SITE_ROOT}/src/lib`;
const DATA = `${SITE_ROOT}/src/data`;

const { getWorkshopReferences } = await import(`${SITE}/api/workshopReference.ts`);
const { getBenchNotes } = await import(`${SITE}/api/benchNotes.ts`);
const { getMaterials } = await import(`${SITE}/api/materials.ts`);
const { getProjects } = await import(`${SITE}/api/projects.ts`);
const { getSite: siteGetSite } = await import(`${SITE}/api/sites.ts`);
const { getSiteChrome: siteGetSiteChrome } = await import(`${SITE}/api/siteChrome.ts`);

const staticSiteData: any = await import(`${DATA}/site.ts`);

const { createMarvinContent, asString, asRecord, asStringArray, collectionSlugs } = await import(
  '../../src/index.js'
);

// Same static fallbacks the site uses, so an offline run compares like with like too.
const marvin = createMarvinContent({
  site: {
    fallback: {
      name: staticSiteData.site.name,
      title: staticSiteData.site.name,
      tagline: staticSiteData.site.tagline,
      description: staticSiteData.site.description,
      email: staticSiteData.site.email,
      imprint: staticSiteData.site.imprint,
      social: staticSiteData.site.social,
      timezone: 'America/New_York',
    },
  },
  chrome: {
    fallback: {
      mainNavigation: staticSiteData.mainNav,
      footerNavigation: staticSiteData.footerNav,
      socialLinks: staticSiteData.socialLinks,
      inquiry: staticSiteData.inquiry,
      legalLinks: [
        { label: 'Terms', href: '/workshop-reference/terms', role: 'legal' },
        { label: 'Privacy', href: '/workshop-reference/privacy', role: 'legal' },
      ],
    },
  },
});

// ---------------------------------------------------------------- workshop reference

const references = marvin.repository<any>({
  collection: 'workshop-reference',
  href: (slug) => `/workshop-reference/${slug}`,
  sort: (a, b) => a.order - b.order,
  transform: async (entry, f) => {
    const summary = asString((entry as any).summary) ?? '';
    const body = asString(f.data().body as string) ?? '';
    return {
      id: String((entry as any).id ?? entry.slug ?? ''),
      slug: entry.slug ?? '',
      title: entry.title || 'Untitled',
      description: asString((entry as any).description) || summary,
      summary,
      order:
        Number(
          f.raw('order') ?? f.metadata().sortOrder ?? (entry as any).order ?? 0
        ) || 0,
      body,
      bodyHtml: await f.markdown('body'),
      icon: f.icon({ fallbackToFeatured: true }),
      difficulty: f.string('difficulty'),
      href: f.href,
    };
  },
});

// ---------------------------------------------------------------- bench notes

const staticBenchNotes: any = await import(`${DATA}/benchNotes.ts`);

const benchNotes = marvin.repository<any>({
  collections: ['bench-notes', 'journal', 'blog', 'posts'],
  hydrate: true,
  href: (slug) => `/bench-notes/${slug}`,
  fallback: () =>
    Promise.all(
      staticBenchNotes.benchNotePosts.map(async (note: any) =>
        note.bodyHtml || !note.body
          ? note
          : { ...note, bodyHtml: await marvin.renderMarkdown(note.body) }
      )
    ),
  transform: async (entry, f) => {
    const meta = f.metadata();
    const bodyList = f.list('body');
    const title = entry.title || 'Untitled';

    return {
      id: String((entry as any).id ?? (meta.noteNumber as string) ?? entry.slug ?? ''),
      slug: entry.slug ?? '',
      title,
      noteNumber: f.string('noteNumber'),
      category: (f.raw('category') as string) ?? 'Making',
      label: f.string('label') ?? '',
      date: f.string('date') ?? f.publishedAt() ?? new Date().toISOString(),
      published: asString(meta.published) ?? f.publishedAt(),
      readTime: f.string('readTime'),
      excerpt: (entry as any).summary ?? (entry as any).description ?? '',
      tags: asStringArray(meta.tags),
      body: bodyList,
      bodyHtml: (await f.markdown('body')) ?? '',
      sideNote: asStringArray(meta.sideNote),
      workshopNote: meta.workshopNote,
      referencedProject: meta.referencedProject,
      previousNote: meta.previousNote,
      nextNote: meta.nextNote,
      image:
        Object.keys(asRecord(meta.image)).length > 0
          ? meta.image
          : { alt: title || '', tone: 'denim' },
      featuredImage: f.image(),
      featured: Boolean(meta.featured),
      href: f.href,
    };
  },
});

// ---------------------------------------------------------------- materials

const materials = marvin.repository<any>({
  collection: 'materials',
  hydrate: true,
  href: (slug) => `/materials/${slug}`,
  filter: (item) => Boolean(item.slug),
  transform: (entry, f) => {
    const specs = [
      { key: 'composition', label: 'Composition' },
      { key: 'weight', label: 'Weight' },
      { key: 'width', label: 'Width' },
      { key: 'color', label: 'Color' },
      { key: 'origin', label: 'Origin' },
      { key: 'care', label: 'Care' },
    ]
      .map(({ key, label }) => ({ label, value: asString(f.data()[key]) ?? '' }))
      .filter((spec) => spec.value && spec.value !== '—');

    return {
      slug: entry.slug ?? '',
      title: entry.title ?? 'Untitled',
      summary: asString((entry as any).summary) ?? asString(f.data().summary as string) ?? '',
      specs,
      image: f.image({ metadataKey: false }),
      href: f.href,
    };
  },
});

// ---------------------------------------------------------------- projects (subset)

const staticProjects: any = await import(`${DATA}/projects.ts`);

const PROJECT_SUBSET = [
  'slug',
  'title',
  'projectNumber',
  'category',
  'material',
  'status',
  'icon',
  'featuredImage',
  'materials',
  'href',
  'featured',
] as const;

const projectSubset = (project: any) =>
  Object.fromEntries(PROJECT_SUBSET.map((key) => [key, project[key]]));

const projects = marvin.repository<any>({
  collections: ['projects', 'goods', 'products'],
  hydrate: true,
  href: (slug) => `/projects/${slug}`,
  fallback: () => staticProjects.projects.map(projectSubset),
  transform: (entry, f) => ({
    slug: entry.slug ?? '',
    title: entry.title || 'Untitled',
    projectNumber: f.string('projectNumber') ?? '',
    category: f.oneOf(
      'category',
      ['Jackets', 'Totes & Bags', 'Accessories', 'Historical Wear', 'Other'],
      'Other'
    ),
    material: f.string('material') ?? '',
    status: f.oneOf(
      'projectStatus',
      ['available', 'current', 'in-progress', 'prototype', 'small-run', 'archived'],
      'available'
    ),
    icon: f.icon(),
    // The site's alt fallback chain is metadata.image.alt → title, not title alone.
    featuredImage: f.image({
      preferRoles: ['hero-grade'],
      alt: asString(asRecord(f.metadata().image).alt) ?? entry.title ?? 'Project image',
    }),
    materials: f.resources({
      types: ['material', 'construction'],
      href: (slug) => `/materials/${slug}`,
    }),
    href: f.href,
    featured: Boolean(f.metadata().featured) || collectionSlugs(entry).includes('featured'),
  }),
});

// ---------------------------------------------------------------- diffing

type Diff = { path: string; site: unknown; pkg: unknown };

/** Two ISO timestamps generated moments apart by `new Date()` are not a real divergence. */
function bothRecentTimestamps(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  return Math.abs(left - right) < 60_000 && Math.abs(Date.now() - left) < 60_000;
}

function diff(site: unknown, pkg: unknown, path = '', out: Diff[] = []): Diff[] {
  if (site === pkg) return out;
  if (bothRecentTimestamps(site, pkg)) return out;

  const bothObjects =
    site && pkg && typeof site === 'object' && typeof pkg === 'object' &&
    Array.isArray(site) === Array.isArray(pkg);

  if (bothObjects) {
    const keys = new Set([
      ...Object.keys(site as object),
      ...Object.keys(pkg as object),
    ]);
    for (const key of keys) {
      diff((site as any)[key], (pkg as any)[key], path ? `${path}.${key}` : key, out);
    }
    return out;
  }

  // undefined vs an absent key is the same thing once serialized.
  if (site == null && pkg == null) return out;

  out.push({ path, site, pkg });
  return out;
}

function report(label: string, siteItems: any[], pkgItems: any[]): boolean {
  const bySlug = (items: any[]) => new Map(items.map((item) => [item.slug, item]));
  const siteMap = bySlug(siteItems);
  const pkgMap = bySlug(pkgItems);
  const slugs = [...new Set([...siteMap.keys(), ...pkgMap.keys()])];

  const diffs: Diff[] = [];
  for (const slug of slugs) {
    diffs.push(...diff(siteMap.get(slug), pkgMap.get(slug), `${slug}`));
  }

  const orderMatches =
    JSON.stringify(siteItems.map((i) => i.slug)) === JSON.stringify(pkgItems.map((i) => i.slug));

  const ok = diffs.length === 0 && orderMatches && siteItems.length === pkgItems.length;
  const mark = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mDIFF\x1b[0m';
  console.log(
    `\n${mark}  ${label}  (site: ${siteItems.length} items, package: ${pkgItems.length} items` +
      `${orderMatches ? '' : ', ORDER DIFFERS'})`
  );
  for (const entry of diffs.slice(0, 40)) {
    console.log(`   ${entry.path}`);
    console.log(`      site: ${JSON.stringify(entry.site)?.slice(0, 160)}`);
    console.log(`      pkg : ${JSON.stringify(entry.pkg)?.slice(0, 160)}`);
  }
  if (diffs.length > 40) console.log(`   … and ${diffs.length - 40} more`);
  return ok;
}

const results: boolean[] = [];

results.push(report('workshop-reference', await getWorkshopReferences(), await references.all()));
results.push(report('bench-notes', await getBenchNotes(), await benchNotes.all()));
results.push(report('materials', await getMaterials(), await materials.all()));

const siteProjects = (await getProjects()).map(projectSubset);
const pkgProjects = (await projects.all()).map((project: any) => ({
  ...projectSubset(project),
  materials: project.materials?.length
    ? project.materials.map((m: any) => ({ name: m.name, type: m.type, role: m.role, href: m.href }))
    : undefined,
}));
results.push(report('projects (subset of fields)', siteProjects, pkgProjects));

// ---------------------------------------------------------------- site + chrome

const siteSite = await siteGetSite();
const pkgSite = await marvin.getSite();
const siteDiffs = diff(siteSite, pkgSite, 'site');
console.log(
  `\n${siteDiffs.length === 0 ? '\x1b[32mPASS\x1b[0m' : '\x1b[33mDIFF\x1b[0m'}  site config`
);
for (const entry of siteDiffs) {
  console.log(`   ${entry.path}`);
  console.log(`      site: ${JSON.stringify(entry.site)?.slice(0, 160)}`);
  console.log(`      pkg : ${JSON.stringify(entry.pkg)?.slice(0, 160)}`);
}
results.push(siteDiffs.length === 0);

const siteChrome = await siteGetSiteChrome();
const pkgChrome = await marvin.getSiteChrome();
const chromeDiffs = diff(
  { ...siteChrome, site: undefined },
  { ...pkgChrome, site: undefined },
  'chrome'
);
console.log(
  `\n${chromeDiffs.length === 0 ? '\x1b[32mPASS\x1b[0m' : '\x1b[33mDIFF\x1b[0m'}  site chrome`
);
for (const entry of chromeDiffs) {
  console.log(`   ${entry.path}`);
  console.log(`      site: ${JSON.stringify(entry.site)?.slice(0, 200)}`);
  console.log(`      pkg : ${JSON.stringify(entry.pkg)?.slice(0, 200)}`);
}
results.push(chromeDiffs.length === 0);

console.log(
  `\n${results.every(Boolean) ? '\x1b[32mAll parity checks passed.\x1b[0m' : '\x1b[31mParity differences found (see above).\x1b[0m'}`
);
process.exit(results.every(Boolean) ? 0 : 1);
