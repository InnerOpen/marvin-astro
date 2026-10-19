import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import CookieTable from '../../src/components/CookieTable.astro';
import PrivacyPolicy from '../../src/components/PrivacyPolicy.astro';
import ProcessorTable from '../../src/components/ProcessorTable.astro';
import { sitePrivacy } from '../../src/privacy.js';
import { NECESSARY_ONLY, rawPrivacy } from '../support/privacy.js';

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const render = (component: Parameters<AstroContainer['renderToString']>[0], props: object, slots?: Record<string, string>) =>
  container.renderToString(component, { props: props as Record<string, unknown>, slots });

const privacy = sitePrivacy(rawPrivacy())!;

describe('CookieTable', () => {
  it('groups cookies by category with a caption per table', async () => {
    const html = await render(CookieTable, { cookies: privacy.cookies });

    expect(html.match(/<table/g)).toHaveLength(3);
    expect(html.match(/<div class="marvin-privacy__table-wrap">/g)).toHaveLength(3);
    expect(html).toMatch(/<caption>\s*Necessary/);
    expect(html).toMatch(/<caption>\s*Analytics/);
    expect(html).toContain('<code>_ga*</code>');
    expect(html).toContain('data-label="Provider"');
  });

  it('adds the marvin-consent row as necessary when the banner is required', async () => {
    const html = await render(CookieTable, { cookies: privacy.cookies });

    expect(html).toContain('<code>marvin-consent</code>');
    expect(html).toContain('6 months');
    expect(html).toContain('Optional cookies are off because JavaScript is disabled.');
    expect(html).toMatch(/<noscript>/);
  });

  it('skips the consent row and noscript notice when told to, or when nothing needs consent', async () => {
    const off = await render(CookieTable, { cookies: privacy.cookies, includeConsentEntry: false });
    expect(off).not.toContain('marvin-consent');

    const quiet = await render(CookieTable, { cookies: NECESSARY_ONLY });
    expect(quiet).not.toContain('marvin-consent');
    expect(quiet).not.toContain('<noscript>');
    expect(quiet).toContain('mb-theme');
  });

  it('does not duplicate an already listed marvin-consent entry', async () => {
    const cookies = [
      ...privacy.cookies,
      { name: 'marvin-consent', provider: 'Us', purpose: 'Choices', category: 'necessary' as const },
    ];
    const html = await render(CookieTable, { cookies });
    expect(html.match(/<code>marvin-consent<\/code>/g)).toHaveLength(1);
  });

  it('narrows to one category and renders nothing for an empty list', async () => {
    const html = await render(CookieTable, { cookies: privacy.cookies, category: 'marketing' });
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).toContain('Ad Co');
    expect(html).not.toContain('_ga*');
    expect((await render(CookieTable, { cookies: [] })).trim()).toBe('');
    expect((await render(CookieTable, { cookies: undefined })).trim()).toBe('');
  });

  it('escapes provider and purpose text', async () => {
    const html = await render(CookieTable, { cookies: privacy.cookies });
    expect(html).not.toContain('<b>Ad Co</b>');
    expect(html).toContain('&lt;b&gt;Ad Co&lt;/b&gt;');
  });

  it('honours label overrides', async () => {
    const html = await render(CookieTable, {
      cookies: privacy.cookies,
      labels: { cookieName: 'Nombre', categories: { analytics: 'Analítica' } },
    });
    expect(html).toContain('Nombre');
    expect(html).toContain('Analítica');
  });
});

describe('ProcessorTable', () => {
  it('renders region, transfer basis and safe links only', async () => {
    const html = await render(ProcessorTable, { processors: privacy.processors });

    expect(html).toContain('Cloudflare');
    expect(html).toContain('EU-US Data Privacy Framework');
    expect(html).toContain('IP address, request metadata');
    expect(html).toContain('href="https://www.cloudflare.com/cloudflare-customer-dpa/"');
    expect(html).toContain('rel="noopener noreferrer"');
    // The javascript: privacyUrl is dropped, so its link label never appears.
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('>Privacy policy<');
  });

  it('renders nothing without processors', async () => {
    expect((await render(ProcessorTable, { processors: [] })).trim()).toBe('');
  });
});

describe('PrivacyPolicy', () => {
  it('renders the slot, controller, processors, cookies and the review date', async () => {
    const html = await render(PrivacyPolicy, { privacy }, { default: '<p>We keep it short.</p>' });

    expect(html).toContain('We keep it short.');
    expect(html).toContain('Mash &amp; Burn Co.');
    expect(html).toContain('href="mailto:privacy@example.com"');
    expect(html).toContain('id="marvin-privacy-processors"');
    expect(html).toContain('id="marvin-privacy-cookies"');
    expect(html).toContain('<time datetime="2026-10-01">Oct 01, 2026</time>');
    expect(html.indexOf('We keep it short.')).toBeLessThan(html.indexOf('marvin-privacy-controller'));
  });

  it('uses headingLevel for section headings and clamps it', async () => {
    expect(await render(PrivacyPolicy, { privacy, headingLevel: 3 })).toMatch(/<h3>Who is responsible/);
    expect(await render(PrivacyPolicy, { privacy, headingLevel: 9 })).toMatch(/<h6>Who is responsible/);
    expect(await render(PrivacyPolicy, { privacy })).toMatch(/<h2>Who is responsible/);
  });

  it('leaves out sections with nothing to say and links "change settings" only with optional cookies', async () => {
    const bare = sitePrivacy({ controller: { legalName: 'Solo' }, cookies: NECESSARY_ONLY })!;
    const html = await render(PrivacyPolicy, { privacy: bare });

    expect(html).toContain('Solo');
    expect(html).not.toContain('marvin-privacy-processors');
    expect(html).not.toContain('data-marvin-consent-open');
    expect(html).not.toContain('Last reviewed');
    expect(await render(PrivacyPolicy, { privacy })).toContain('data-marvin-consent-open');
  });

  it('renders nothing for absent privacy without a slot', async () => {
    expect((await render(PrivacyPolicy, { privacy: undefined })).trim()).toBe('');
  });
});

describe('privacy.css', () => {
  const css = readFileSync(new URL('../../src/components/privacy.css', import.meta.url), 'utf8');

  it('keeps every rule at zero specificity', () => {
    // Declaration blocks only: `selector { ... }`, ignoring the @media wrappers around them.
    const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)]
      .map((match) => match[1]!.trim())
      .filter((text) => !text.startsWith('@'));
    expect(selectors.length).toBeGreaterThan(5);
    for (const selector of selectors) {
      // Every compound in a selector list must be a :where() group.
      for (const part of selector.split(/,(?![^(]*\))/)) {
        expect(part.trim().startsWith(':where('), part).toBe(true);
      }
    }
  });

  const rule = (selectorPart: string) =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) => match[1]!.includes(selectorPart))
      .map((match) => match[2]!)
      .join('\n');

  it('wraps ordinary words at word boundaries, never mid-word', () => {
    const cells = rule('.marvin-privacy__table th, .marvin-privacy__table td');
    expect(cells).toMatch(/overflow-wrap:\s*break-word/);
    expect(cells).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(cells).not.toMatch(/word-break:\s*(break-all|break-word)/);
  });

  it('lets only unbreakable tokens (code, email links) break anywhere', () => {
    const tokens = rule('.marvin-privacy__table code');
    expect(tokens).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule('.marvin-privacy__table code')).toBe(rule('a[href^="mailto:"]'));
    expect(css.match(/overflow-wrap:\s*anywhere/g)).toHaveLength(1);
  });

  it('lets the facts value column shrink so a long address cannot overflow', () => {
    expect(rule('.marvin-privacy__facts dd')).toMatch(/min-width:\s*0/);
  });

  it('keeps the policy and its tables inside the container', () => {
    expect(rule('.marvin-privacy)')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rule('.marvin-privacy__table-wrap')).toMatch(/overflow-x:\s*auto/);
    expect(rule('.marvin-privacy__table-wrap')).toMatch(/max-width:\s*100%/);
    expect(rule('.marvin-privacy__table caption')).toMatch(/display:\s*block/);
  });

  it('themes through --marvin-privacy-* and stacks below 600px', () => {
    expect(css).toMatch(/--marvin-privacy-gap/);
    expect(css).toMatch(/@media \(max-width: 599px\)/);
  });
});
