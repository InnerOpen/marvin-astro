/**
 * The iframe rules shared by `<Embed>` (server) and `<EmbedLoader>` (browser).
 *
 * A click-to-load facade carries its iframe as data: `data-marvin-embed-attrs` (a JSON object of
 * attributes) and `data-marvin-embed-hosts` (the frame hosts it may load). The loader builds the
 * iframe from those attributes alone, keeps only the allow-listed ones, and refuses any `src`
 * that isn't https on an allowed host. Nothing from the page is ever parsed as HTML.
 *
 * This module has no imports so the browser bundle stays a few hundred bytes.
 */

/** Every attribute the loader will set on an iframe. Anything else in the data is dropped. */
export const IFRAME_ATTRIBUTES: readonly string[] = [
  'src',
  'title',
  'allow',
  'sandbox',
  'referrerpolicy',
  'loading',
  'style',
];

/** Inline style that could fetch or execute something, or break out of the attribute. */
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|@import|javascript:|\\|[<>]/i;

/**
 * A frame-source entry reduced to a lowercase host pattern: `example.com` or `*.example.com`.
 * Accepts the forms a CSP `frame-src` list uses (`https://example.com`, `example.com:443`,
 * `https://*.example.com/path`).
 */
export function frameHostPattern(source: unknown): string | undefined {
  if (typeof source !== 'string') return undefined;
  const host = source
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '');
  return /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host) ? host : undefined;
}

/** True when `src` is an https URL whose host matches one of `hosts`. */
export function isAllowedFrameSrc(src: unknown, hosts: readonly unknown[]): src is string {
  if (typeof src !== 'string') return false;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  return hosts.some((entry) => {
    const pattern = frameHostPattern(entry);
    if (!pattern) return false;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // ".example.com"
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === pattern;
  });
}

/**
 * The attributes to put on the iframe, or `undefined` when the src isn't allowed.
 *
 * Only {@link IFRAME_ATTRIBUTES} survive, with string (or number) values; an unsafe `style` is
 * dropped. `src` comes from `attrs.src`, falling back to `fallbackSrc` (the facade's
 * `data-marvin-embed-src`); either way it must pass the host check.
 */
export function iframeAttributes(
  attrs: unknown,
  hosts: readonly unknown[],
  fallbackSrc?: string | null
): Record<string, string> | undefined {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return undefined;

  const safe: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(attrs as Record<string, unknown>)) {
    const key = rawKey.toLowerCase();
    if (!IFRAME_ATTRIBUTES.includes(key)) continue;
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number') continue;
    const value = String(rawValue);
    if (key === 'style' && UNSAFE_STYLE.test(value)) continue;
    safe[key] = value;
  }

  const src = safe.src ?? fallbackSrc ?? undefined;
  if (!isAllowedFrameSrc(src, hosts)) return undefined;
  safe.src = src;
  safe.title ||= 'Embedded media';
  return safe;
}

/** `href` when it is an absolute http(s) URL, else `undefined` (no `javascript:` links). */
export function safeLinkHref(href: unknown): string | undefined {
  if (typeof href !== 'string') return undefined;
  try {
    const url = new URL(href.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** The facade buttons the loader acts on. */
export const FACADE_SELECTOR = 'button[data-marvin-embed-attrs], button[data-marvin-embed-src]';

/**
 * Swap one facade button for its iframe. Returns the iframe, or `null` when the data is refused
 * (the facade is then marked `marvin-embed--blocked` and its plain link stays usable).
 */
export function activateEmbedFacade(button: Element, doc: Document): HTMLIFrameElement | null {
  const hosts = parseJson(button.getAttribute('data-marvin-embed-hosts'));
  const attributes = iframeAttributes(
    parseJson(button.getAttribute('data-marvin-embed-attrs')),
    Array.isArray(hosts) ? hosts : [],
    button.getAttribute('data-marvin-embed-src')
  );
  const figure = button.closest('.marvin-embed');

  if (!attributes) {
    figure?.classList.add('marvin-embed--blocked');
    button.setAttribute('disabled', '');
    return null;
  }

  const iframe = doc.createElement('iframe');
  // `src` last, after sandbox/allow are in place.
  for (const [name, value] of Object.entries(attributes)) {
    if (name !== 'src') iframe.setAttribute(name, value);
  }
  iframe.setAttribute('src', attributes.src);

  button.replaceWith(iframe);
  figure?.classList.remove('marvin-embed--facade');
  figure?.classList.add('marvin-embed--loaded');
  // Keyboard users pressed Enter/Space on the button that just vanished; keep their place.
  iframe.focus();
  return iframe;
}

const INSTALLED = '__marvinEmbedLoader';

/** One delegated click listener per document, covering facades added later too. */
export function installEmbedLoader(doc: Document): void {
  const marker = doc as Document & { [INSTALLED]?: boolean };
  if (marker[INSTALLED]) return;
  marker[INSTALLED] = true;

  doc.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const button = typeof target?.closest === 'function' ? target.closest(FACADE_SELECTOR) : null;
    if (!button) return;
    event.preventDefault();
    activateEmbedFacade(button, doc);
  });
}
