import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import ConsentBanner from '../../src/components/ConsentBanner.astro';
import { CONSENT_KEY, installConsent, type ConsentDetail } from '../../src/components/consent.js';
import { consentVersion, sitePrivacy } from '../../src/privacy.js';
import { NECESSARY_ONLY, rawPrivacy } from '../support/privacy.js';

const DAY = 864e5;
const T0 = Date.UTC(2026, 9, 19);
const privacy = sitePrivacy(rawPrivacy())!;
const VERSION = consentVersion(privacy);

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const renderBanner = (props: object) =>
  container.renderToString(ConsentBanner, { props: { warn: false, ...props } as Record<string, unknown> });

const GATED = `
  <main id="content">page</main>
  <a id="settings" href="/privacy" data-marvin-consent-open>Cookie settings</a>
  <script type="text/plain" data-consent="analytics">window.__ran.push('inline-analytics')</script>
  <script type="text/plain" data-consent="analytics" data-src="https://stats.test/a.js" data-type="module" id="stats" defer crossorigin="anonymous"></script>
  <script type="text/plain" data-consent="analytics marketing">window.__ran.push('both')</script>
  <script type="text/plain" data-consent="analytic">window.__ran.push('typo')</script>
  <script type="text/plain" data-consent="">window.__ran.push('empty')</script>
  <template data-consent="marketing"><p id="ad">ad</p><script>window.__ran.push('template-script')</script></template>
`;

type Setup = { stored?: unknown; props?: object; extra?: string; throwStorage?: boolean };

async function setup({ stored, props, extra = '', throwStorage }: Setup = {}) {
  const banner = await renderBanner({ privacy, policyHref: '/privacy', ...props });
  const dom = new JSDOM(`<!doctype html><body>${banner}${GATED}${extra}</body>`, {
    url: 'https://www.example.com/page',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  (window as unknown as { __ran: string[] }).__ran = [];
  // jsdom has no <dialog> behaviour; model the parts the runtime relies on.
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };
  if (stored !== undefined) window.localStorage.setItem(CONSENT_KEY, JSON.stringify(stored));
  if (throwStorage) {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new window.DOMException('blocked', 'SecurityError');
      },
    });
  }
  const reload = vi.fn();
  const doc = window.document;
  const api = installConsent(doc, { reload, now: () => T0 });
  const events: ConsentDetail[] = [];
  doc.addEventListener('marvin:consent', (event) => events.push((event as CustomEvent).detail));
  const ran = () => (window as unknown as { __ran: string[] }).__ran;
  const bar = doc.querySelector<HTMLElement>('[data-marvin-consent-bar]')!;
  const dialog = doc.querySelector<HTMLDialogElement>('dialog')!;
  const click = (selector: string, init: MouseEventInit = {}) => {
    const el = doc.querySelector<HTMLElement>(selector)!;
    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(event);
    return event;
  };
  const tick = () => new Promise((resolve) => window.setTimeout(resolve, 5));
  return { window, doc, api, reload, events, ran, bar, dialog, click, tick };
}

const record = (choices: object, over: Partial<{ version: string; at: number; v: number }> = {}) => ({
  v: 1,
  version: VERSION,
  at: T0 - DAY,
  choices: { preferences: false, analytics: false, marketing: false, ...choices },
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe('consent runtime: first visit', () => {
  it('reveals the banner and activates nothing without a record', async () => {
    const t = await setup();
    expect(t.bar.hidden).toBe(false);
    expect(t.api?.get()).toBeNull();
    expect(t.api?.has('necessary')).toBe(true);
    expect(t.api?.has('analytics')).toBe(false);
    await t.tick();
    expect(t.ran()).toEqual([]);
    expect(t.doc.querySelectorAll('script[type="text/plain"]')).toHaveLength(5);
    expect(t.events).toEqual([]);
  });

  it('does nothing when no banner is on the page', async () => {
    const dom = new JSDOM('<!doctype html><body><script type="text/plain" data-consent="analytics">1</script></body>', { url: 'https://example.com/' });
    expect(installConsent(dom.window.document)).toBeUndefined();
    expect(dom.window.marvinConsent).toBeUndefined();
    expect(dom.window.document.querySelectorAll('script[type="text/plain"]')).toHaveLength(1);
  });

  it('is idempotent', async () => {
    const t = await setup();
    expect(installConsent(t.doc)).toBe(t.api);
  });
});

describe('consent runtime: choices', () => {
  it('Accept all stores the record and activates gated markup', async () => {
    const t = await setup();
    t.click('[data-marvin-consent-action="accept"]');

    const stored = JSON.parse(t.window.localStorage.getItem(CONSENT_KEY)!);
    expect(stored).toEqual({
      v: 1,
      version: VERSION,
      at: T0,
      choices: { preferences: false, analytics: true, marketing: true },
    });
    expect(t.bar.hidden).toBe(true);
    expect(t.ran().sort()).toEqual(['both', 'inline-analytics', 'template-script']);
    expect(t.doc.getElementById('ad')).not.toBeNull();
    expect(t.doc.querySelector('template')).toBeNull();
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('Reject all stores the refusal and activates nothing', async () => {
    const t = await setup();
    t.click('[data-marvin-consent-action="reject"]');

    expect(JSON.parse(t.window.localStorage.getItem(CONSENT_KEY)!).choices).toEqual({
      preferences: false,
      analytics: false,
      marketing: false,
    });
    expect(t.ran()).toEqual([]);
    expect(t.bar.hidden).toBe(true);
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('Save choices from the dialog applies a partial choice', async () => {
    const t = await setup();
    t.click('[data-marvin-consent-action="customise"]');
    expect(t.dialog.hasAttribute('open')).toBe(true);
    t.doc.querySelector<HTMLInputElement>('input[name="analytics"]')!.checked = true;
    t.click('[data-marvin-consent-action="save"]');

    expect(t.api?.get()?.choices).toEqual({ preferences: false, analytics: true, marketing: false });
    expect(t.ran()).toEqual(['inline-analytics']);
    expect(t.doc.getElementById('ad')).toBeNull();
    expect(t.dialog.hasAttribute('open')).toBe(false);
  });

  it('requires every listed category, and never activates an unknown or empty one', async () => {
    const t = await setup();
    t.api!.set({ analytics: true });
    expect(t.ran()).toEqual(['inline-analytics']);
    t.api!.set({ marketing: true });
    expect(t.ran().sort()).toEqual(['both', 'inline-analytics', 'template-script']);
    expect(t.ran()).not.toContain('typo');
    expect(t.ran()).not.toContain('empty');
  });

  it('runs each gated item once, however many choices follow', async () => {
    const t = await setup();
    t.api!.set({ analytics: true });
    t.api!.set({ analytics: true, marketing: true });
    t.api!.set({ marketing: true });
    expect(t.ran().filter((entry) => entry === 'inline-analytics')).toHaveLength(1);
  });

  it('turns data-src into src, keeping other attributes and dropping the gating ones', async () => {
    const t = await setup();
    t.api!.set({ analytics: true });
    const script = t.doc.getElementById('stats') as HTMLScriptElement;

    expect(script.getAttribute('src')).toBe('https://stats.test/a.js');
    expect(script.getAttribute('type')).toBe('module');
    expect(script.hasAttribute('defer')).toBe(true);
    expect(script.getAttribute('crossorigin')).toBe('anonymous');
    expect(script.hasAttribute('data-consent')).toBe(false);
    expect(script.hasAttribute('data-src')).toBe(false);
  });

  it('keeps unspecified categories at their current value in set()', async () => {
    const t = await setup({ stored: record({ analytics: true }) });
    t.api!.set({ marketing: true });
    expect(t.api!.get()?.choices).toEqual({ preferences: false, analytics: true, marketing: true });
  });

  it('survives blocked storage, keeping the choice for the page', async () => {
    const t = await setup({ throwStorage: true });
    expect(t.bar.hidden).toBe(false);
    t.api!.set({ analytics: true });
    expect(t.api!.has('analytics')).toBe(true);
    expect(t.ran()).toEqual(['inline-analytics']);
  });
});

describe('consent runtime: stored choices', () => {
  it('honours a valid record on load: scripts run, banner stays hidden, initial event fires', async () => {
    const t = await setup({ stored: record({ analytics: true }) });
    expect(t.bar.hidden).toBe(true);
    expect(t.ran()).toEqual(['inline-analytics']);
    expect(t.api!.has('analytics')).toBe(true);
    expect(t.events).toEqual([]);
    await t.tick();
    expect(t.events).toEqual([
      { choices: { preferences: false, analytics: true, marketing: false }, version: VERSION, initial: true },
    ]);
  });

  it('honours a stored refusal (no banner, nothing runs)', async () => {
    const t = await setup({ stored: record({}) });
    expect(t.bar.hidden).toBe(true);
    expect(t.api!.get()).not.toBeNull();
    expect(t.ran()).toEqual([]);
  });

  it('asks again once the choice is older than maxAgeDays, refusals included', async () => {
    for (const choices of [{ analytics: true }, {}]) {
      const t = await setup({ stored: record(choices, { at: T0 - 181 * DAY }) });
      expect(t.bar.hidden, JSON.stringify(choices)).toBe(false);
      expect(t.ran()).toEqual([]);
      expect(t.api!.get()).toBeNull();
    }
  });

  it('keeps a choice just inside the expiry and honours a custom maxAgeDays', async () => {
    expect((await setup({ stored: record({}, { at: T0 - 179 * DAY }) })).bar.hidden).toBe(true);
    const short = await setup({ stored: record({}, { at: T0 - 31 * DAY }), props: { maxAgeDays: 30 } });
    expect(short.bar.hidden).toBe(false);
  });

  it('asks again when the consent version no longer matches, with scripts inert', async () => {
    const t = await setup({ stored: record({ analytics: true }, { version: 'deadbeef' }) });
    expect(t.bar.hidden).toBe(false);
    expect(t.ran()).toEqual([]);
    expect(t.api!.has('analytics')).toBe(false);
  });

  it('ignores corrupt or foreign records', async () => {
    for (const stored of [record({}, { v: 2 }), 'junk', { v: 1 }, null]) {
      const t = await setup({ stored });
      expect(t.bar.hidden, JSON.stringify(stored)).toBe(false);
    }
  });
});

describe('consent runtime: events', () => {
  it('fires marvin:consent on change with initial false', async () => {
    const t = await setup();
    t.click('[data-marvin-consent-action="accept"]');
    expect(t.events).toEqual([
      { choices: { preferences: false, analytics: true, marketing: true }, version: VERSION, initial: false },
    ]);
  });
});

describe('consent runtime: withdrawal', () => {
  const COOKIES = [
    '_ga=1; path=/',
    '_ga_ABC123=2; path=/; domain=example.com',
    '_gid=3; path=/; domain=www.example.com',
    'ads=4; path=/',
    'session=keep; path=/',
  ];

  it('expires listed cookies of revoked categories (wildcards, host and parent domain), then reloads', async () => {
    const t = await setup({ stored: record({ analytics: true, marketing: true }) });
    COOKIES.forEach((cookie) => (t.doc.cookie = cookie));
    expect(t.doc.cookie).toContain('_ga_ABC123=2');

    t.click('[data-marvin-consent-action="customise"]');
    t.doc.querySelector<HTMLInputElement>('input[name="analytics"]')!.checked = false;
    t.doc.querySelector<HTMLInputElement>('input[name="marketing"]')!.checked = true;
    t.click('[data-marvin-consent-action="save"]');

    const left = t.doc.cookie.split('; ').map((pair) => pair.split('=')[0]);
    expect(left).not.toContain('_ga');
    expect(left).not.toContain('_ga_ABC123');
    expect(left).toContain('ads');
    expect(left).toContain('session');
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('clears the listed cookies of every refused category, including a first refusal, without reloading', async () => {
    const t = await setup();
    COOKIES.forEach((cookie) => (t.doc.cookie = cookie));
    t.click('[data-marvin-consent-action="reject"]');

    const left = t.doc.cookie.split('; ').map((pair) => pair.split('=')[0]);
    // `_gid` is not in the listed cookie set, so it is not ours to delete.
    expect(left).toEqual(['_gid', 'session']);
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('does not reload when nothing was revoked', async () => {
    const t = await setup({ stored: record({ analytics: true }) });
    t.api!.set({ marketing: true });
    expect(t.reload).not.toHaveBeenCalled();
  });
});

describe('consent runtime: embeds opt-in', () => {
  const FACADE = '<figure><button type="button" data-marvin-embed-src="https://www.youtube-nocookie.com/embed/x">Play</button></figure>';

  it('presses click-to-load facades once the configured category is allowed', async () => {
    const t = await setup({ props: { embeds: 'marketing' }, extra: FACADE });
    const pressed = vi.fn();
    t.doc.addEventListener('click', (event) => {
      if ((event.target as Element).closest('button[data-marvin-embed-src]')) pressed();
    });
    t.api!.set({ analytics: true });
    expect(pressed).not.toHaveBeenCalled();
    t.api!.set({ marketing: true });
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it('leaves facades alone by default', async () => {
    const t = await setup({ extra: FACADE });
    const pressed = vi.fn();
    t.doc.addEventListener('click', pressed);
    t.api!.set({ analytics: true, marketing: true });
    expect(pressed).not.toHaveBeenCalled();
  });

  it('presses facades on load when consent is already stored', async () => {
    const t = await setup({ stored: record({ marketing: true }), props: { embeds: 'marketing' }, extra: FACADE });
    const pressed = vi.fn();
    t.doc.addEventListener('click', pressed);
    await t.tick();
    expect(pressed).toHaveBeenCalledTimes(1);
  });
});

describe('consent runtime: settings, keyboard and focus', () => {
  it('the settings link opens the dialog with current choices ticked', async () => {
    const t = await setup({ stored: record({ analytics: true }) });
    const event = t.click('#settings');

    expect(event.defaultPrevented).toBe(true);
    expect(t.dialog.hasAttribute('open')).toBe(true);
    expect(t.doc.querySelector<HTMLInputElement>('input[name="analytics"]')!.checked).toBe(true);
    expect(t.doc.querySelector<HTMLInputElement>('input[name="marketing"]')!.checked).toBe(false);
  });

  it('leaves modified clicks (new tab) to the browser', async () => {
    const t = await setup();
    expect(t.click('#settings', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(t.click('#settings', { button: 1 }).defaultPrevented).toBe(false);
    expect(t.dialog.hasAttribute('open')).toBe(false);
  });

  it('Customise then Esc (dialog close) returns focus to Customise and leaves the bar up', async () => {
    const t = await setup();
    const customise = t.doc.querySelector<HTMLElement>('[data-marvin-consent-action="customise"]')!;
    customise.focus();
    t.click('[data-marvin-consent-action="customise"]');
    t.dialog.dispatchEvent(new t.window.Event('close'));

    expect(t.doc.activeElement).toBe(customise);
    expect(t.bar.hidden).toBe(false);
    expect(t.api!.get()).toBeNull();
  });

  it('a banner choice moves focus to <main>', async () => {
    const t = await setup();
    t.doc.querySelector<HTMLElement>('[data-marvin-consent-action="accept"]')!.focus();
    t.click('[data-marvin-consent-action="accept"]');
    expect(t.doc.activeElement).toBe(t.doc.querySelector('main'));
  });

  it('Save from Customise moves focus to <main>; from the settings link it returns to the link', async () => {
    const a = await setup();
    a.click('[data-marvin-consent-action="customise"]');
    a.click('[data-marvin-consent-action="save"]');
    expect(a.doc.activeElement).toBe(a.doc.querySelector('main'));

    const b = await setup({ stored: record({}) });
    b.doc.getElementById('settings')!.focus();
    b.click('#settings');
    b.click('[data-marvin-consent-action="save"]');
    expect(b.doc.activeElement).toBe(b.doc.getElementById('settings'));
  });

  it('open() opens the dialog from the API', async () => {
    const t = await setup();
    t.api!.open();
    expect(t.dialog.hasAttribute('open')).toBe(true);
  });
});

describe('runtime source', () => {
  const source = readFileSync(new URL('../../src/components/consent.ts', import.meta.url), 'utf8');

  it('has zero imports', () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(|import\(/);
  });

  it('stays under 3 KB gzipped, minified and bundled', async () => {
    const result = await build({
      stdin: {
        contents: `import { installConsent } from './consent.ts'; installConsent(document);`,
        resolveDir: new URL('../../src/components/', import.meta.url).pathname,
        loader: 'ts',
      },
      bundle: true,
      minify: true,
      format: 'esm',
      target: 'es2020',
      write: false,
    });
    const gzipped = gzipSync(result.outputFiles[0]!.contents, { level: 9 }).length;
    expect(gzipped).toBeLessThan(3 * 1024);
  });
});

describe('<ConsentBanner>', () => {
  it('renders nothing (no markup, no script) when no banner is required', async () => {
    for (const value of [
      undefined,
      null,
      sitePrivacy({ cookies: NECESSARY_ONLY }),
      sitePrivacy({ cookies: [] }),
    ]) {
      expect((await renderBanner({ privacy: value })).trim(), String(value)).toBe('');
    }
  });

  it('in dev builds warns when data-consent markup has no banner to activate it', async () => {
    const html = await container.renderToString(ConsentBanner, {
      props: { privacy: sitePrivacy({ cookies: NECESSARY_ONLY }), warn: true },
    });
    expect(html).toContain("querySelector('[data-consent]')");
    expect(html).not.toContain('marvin-consent');
    expect(await container.renderToString(ConsentBanner, { props: { privacy, warn: true } })).not.toContain("querySelector('[data-consent]')");
  });

  it('renders hidden markup with the version, categories and cookie names for the runtime', async () => {
    const html = await renderBanner({ privacy, policyHref: '/privacy' });

    expect(html).toMatch(/<section[^>]*data-marvin-consent-bar[^>]*aria-labelledby="marvin-consent-title"[^>]* hidden/);
    expect(html).toContain(`data-version="${VERSION}"`);
    expect(html).toContain('data-max-age="180"');
    expect(html).toContain('data-categories="analytics marketing"');
    expect(JSON.parse(html.match(/data-cookies="([^"]*)"/)![1]!.replaceAll('&#34;', '"'))).toEqual({
      analytics: ['_ga*'],
      marketing: ['ads'],
    });
    expect(html).toContain('href="/privacy"');
    expect(html).not.toContain('data-embeds');
  });

  it('gives Accept all and Reject all identical classes, and Customise sits beside them', async () => {
    const html = await renderBanner({ privacy });
    const classOf = (action: string) =>
      html.match(new RegExp(`class="([^"]*)" data-marvin-consent-action="${action}"`))?.[1];

    expect(classOf('accept')).toBe(classOf('reject'));
    expect(classOf('accept')).toBe('marvin-consent__button');
    expect(classOf('customise')).toContain('marvin-consent__button');
    expect(html.indexOf('data-marvin-consent-action="accept"')).toBeLessThan(
      html.indexOf('data-marvin-consent-action="customise"')
    );
    expect(html).not.toMatch(/>\s*[×✕X]\s*<\/button>/);
  });

  it('offers only categories the site lists, none pre-ticked, necessary ticked and disabled', async () => {
    const html = await renderBanner({ privacy });
    const inputs = [...html.matchAll(/<input[^>]*>/g)].map((match) => match[0]);

    expect(inputs).toHaveLength(3);
    expect(inputs[0]).toMatch(/checked/);
    expect(inputs[0]).toMatch(/disabled/);
    for (const input of inputs.slice(1)) expect(input).not.toMatch(/checked|disabled/);
    expect(html).not.toContain('name="preferences"');
    expect(html).toContain('<dialog');
  });

  it('escapes cookie names and policy text, and drops a javascript: policy link', async () => {
    const nasty = sitePrivacy({
      cookies: [{ name: '<img src=x onerror=alert(1)>', provider: 'p', purpose: 'x', category: 'analytics' }],
    });
    const html = await renderBanner({
      privacy: nasty,
      policyHref: 'javascript:alert(1)',
      labels: { title: '<script>alert(2)</script>' },
    });

    // Outside quoted attribute values (where `<` is inert) the name only appears escaped.
    const outsideAttributes = html.replace(/="[^"]*"/g, '=""');
    expect(outsideAttributes).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>alert(2)');
    expect(html).not.toContain('javascript:');
  });

  it('inlines its stylesheet where it renders, unless inlineStyles is false', async () => {
    const html = await renderBanner({ privacy });
    expect(html).toMatch(/<style>:where\(\.marvin-consent\) ?\{/);
    expect(html).not.toContain('/*');
    expect(await renderBanner({ privacy, inlineStyles: false })).not.toContain('<style');
    expect((await renderBanner({ privacy: sitePrivacy({ cookies: NECESSARY_ONLY }) })).trim()).toBe('');
  });

  it('applies label and maxAgeDays overrides and the embeds opt-in', async () => {
    const html = await renderBanner({
      privacy,
      labels: { acceptAll: 'Aceptar todo', categories: { analytics: 'Analítica' } },
      maxAgeDays: 365,
      embeds: 'marketing',
    });
    expect(html).toContain('Aceptar todo');
    expect(html).toContain('Analítica');
    expect(html).toContain('data-max-age="365"');
    expect(html).toContain('data-embeds="marketing"');
  });
});
