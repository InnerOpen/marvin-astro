/**
 * The consent runtime behind `<ConsentBanner>`.
 *
 * It remembers one visitor choice per consent version in `localStorage['marvin-consent']`, turns
 * inert markup on only for categories the visitor allowed, and exposes `window.marvinConsent`.
 * Nothing optional runs until a valid choice exists, and without JavaScript nothing runs at all.
 *
 * Gating markup (the category list is space or comma separated; every listed category must be
 * allowed, `necessary` always is):
 *
 *   <script type="text/plain" data-consent="analytics" data-src="https://…"></script>
 *   <script type="text/plain" data-consent="analytics">inline code</script>
 *   <template data-consent="marketing"><iframe …></iframe></template>
 *
 * An unknown category never activates. `data-type="module"` restores a module type.
 *
 * This module has no imports so the browser bundle stays small (measured under 3 KB gzipped).
 */

export type ConsentCategoryName = 'preferences' | 'analytics' | 'marketing';
export type ConsentChoices = Record<ConsentCategoryName, boolean>;

export type ConsentRecord = {
  v: 1;
  /** The `consentVersion()` the choice answers. */
  version: string;
  choices: ConsentChoices;
  /** Epoch milliseconds the choice was made. */
  at: number;
};

export type MarvinConsentApi = {
  /** The current valid record, or `null` while the visitor still has to choose. */
  get(): ConsentRecord | null;
  /** `necessary` is always true; others need a valid choice that allows them. */
  has(category: string): boolean;
  /** Record a choice (unspecified categories keep their current value), then apply it. */
  set(choices: Partial<ConsentChoices>): void;
  /** Open the Customise dialog. */
  open(): void;
};

export type ConsentDetail = { choices: ConsentChoices; version: string; initial: boolean };

export type InstallOptions = {
  /** Reload after a withdrawal. Defaults to `location.reload()`. */
  reload?: () => void;
  /** Clock override for tests. */
  now?: () => number;
};

declare global {
  interface Window {
    marvinConsent?: MarvinConsentApi;
  }
}

export const CONSENT_KEY = 'marvin-consent';
const CATEGORIES: readonly ConsentCategoryName[] = ['preferences', 'analytics', 'marketing'];
const DAY = 864e5;
const GATED = 'script[type="text/plain"][data-consent],template[data-consent]';
const FACADE = 'button[data-marvin-embed-attrs],button[data-marvin-embed-src]';

export function installConsent(doc: Document, options: InstallOptions = {}): MarvinConsentApi | undefined {
  const win = doc.defaultView as Window & typeof globalThis;
  const root = doc.querySelector<HTMLElement>('[data-marvin-consent-banner]');
  if (!win || !root) return undefined;
  if (win.marvinConsent) return win.marvinConsent;

  const now = options.now ?? Date.now;
  const reload = options.reload ?? (() => win.location.reload());
  const bar = root.querySelector<HTMLElement>('[data-marvin-consent-bar]');
  const dialog = root.querySelector<HTMLDialogElement>('dialog');
  const version = root.dataset.version ?? '';
  const maxAge = (Number(root.dataset.maxAge) || 180) * DAY;
  const offered = (root.dataset.categories ?? '').split(' ').filter(Boolean) as ConsentCategoryName[];
  const embedsCategory = root.dataset.embeds;
  let cookieNames: Record<string, string[]> = {};
  try {
    cookieNames = JSON.parse(root.dataset.cookies ?? '{}');
  } catch {
    /* no withdrawal cleanup, the reload still stops the scripts */
  }

  let record: ConsentRecord | null = null;
  let opener: Element | null = null;

  const read = (): ConsentRecord | null => {
    try {
      const raw = JSON.parse(win.localStorage.getItem(CONSENT_KEY) ?? 'null');
      if (
        raw?.v === 1 &&
        raw.version === version &&
        typeof raw.at === 'number' &&
        now() - raw.at < maxAge &&
        raw.choices
      ) {
        return {
          v: 1,
          version,
          at: raw.at,
          choices: Object.fromEntries(CATEGORIES.map((c) => [c, raw.choices[c] === true])) as ConsentChoices,
        };
      }
    } catch {
      /* storage blocked or corrupt: ask again */
    }
    return null;
  };

  const allowed = (category: string) => category === 'necessary' || record?.choices[category as ConsentCategoryName] === true;

  const activate = () => {
    doc.querySelectorAll<HTMLElement>(GATED).forEach((el) => {
      const needs = (el.dataset.consent ?? '').split(/[\s,]+/).filter(Boolean);
      if (!needs.length || !needs.every(allowed)) return;
      if (el instanceof win.HTMLTemplateElement) {
        el.replaceWith(doc.importNode(el.content, true));
        return;
      }
      const script = doc.createElement('script');
      script.async = false;
      for (const { name, value } of Array.from(el.attributes)) {
        if (!['type', 'data-consent', 'data-src', 'data-type'].includes(name)) script.setAttribute(name, value);
      }
      if (el.dataset.src) script.src = el.dataset.src;
      if (el.dataset.type) script.type = el.dataset.type;
      script.text = el.textContent ?? '';
      el.replaceWith(script);
    });
  };

  /** Delete first-party cookies by name; a trailing `*` matches a prefix. Host and parent domains. */
  const expire = (patterns: string[] = []) => {
    const present = doc.cookie.split(';').map((pair) => pair.split('=')[0]!.trim()).filter(Boolean);
    const labels = win.location.hostname.split('.');
    const domains = ['', ...labels.slice(0, -1).map((_, i) => labels.slice(i).join('.'))];
    if (labels.length < 2) domains.push(win.location.hostname);
    for (const pattern of patterns) {
      const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : null;
      for (const name of present.filter((n) => (prefix === null ? n === pattern : n.startsWith(prefix)))) {
        for (const domain of domains) {
          doc.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;max-age=0;path=/${domain ? `;domain=${domain}` : ''}`;
        }
      }
    }
  };

  const emit = (initial: boolean) => {
    if (!record) return;
    const detail: ConsentDetail = { choices: { ...record.choices }, version, initial };
    doc.dispatchEvent(new win.CustomEvent('marvin:consent', { detail }));
  };

  const loadEmbeds = () => {
    // The facades' own delegated handler does the work; this only presses them.
    if (embedsCategory && allowed(embedsCategory)) doc.querySelectorAll<HTMLElement>(FACADE).forEach((b) => b.click());
  };

  const focusAfter = () => {
    const back = opener && doc.contains(opener) && (!bar?.contains(opener) || !bar.hidden) ? opener : null;
    const target = (back ?? doc.querySelector<HTMLElement>('main,[role="main"]')) as HTMLElement | null;
    if (target && !target.matches('a,button,input,select,textarea,[tabindex]')) target.setAttribute('tabindex', '-1');
    target?.focus({ preventScroll: true });
  };

  const closeDialog = () => {
    if (dialog?.open) typeof dialog.close === 'function' ? dialog.close() : dialog.removeAttribute('open');
    focusAfter();
  };

  const api: MarvinConsentApi = {
    get: () => (record ? { ...record, choices: { ...record.choices } } : null),
    has: allowed,
    set(choices) {
      const previous = record;
      const next: ConsentChoices = { preferences: false, analytics: false, marketing: false };
      for (const c of CATEGORIES) next[c] = choices[c] ?? previous?.choices[c] ?? false;
      record = { v: 1, version, choices: next, at: now() };
      try {
        win.localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
      } catch {
        /* kept in memory for this page only */
      }
      CATEGORIES.filter((c) => !next[c]).forEach((c) => expire(cookieNames[c]));
      if (bar) bar.hidden = true;
      emit(false);
      if (CATEGORIES.some((c) => previous?.choices[c] && !next[c])) {
        reload();
        return;
      }
      activate();
      loadEmbeds();
    },
    open() {
      if (!dialog) return;
      dialog.querySelectorAll<HTMLInputElement>('input[data-marvin-consent-category]').forEach((input) => {
        input.checked = record?.choices[input.dataset.marvinConsentCategory as ConsentCategoryName] === true;
      });
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    },
  };

  const choose = (accept: boolean) =>
    api.set(Object.fromEntries(CATEGORIES.map((c) => [c, accept && offered.includes(c)])));

  doc.addEventListener('click', (event) => {
    const mouse = event as MouseEvent;
    const target = (event.target as Element | null)?.closest?.('[data-marvin-consent-action],[data-marvin-consent-open]');
    if (!target || mouse.button || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey) return;
    event.preventDefault();
    const action = target.getAttribute('data-marvin-consent-action');
    if (!action || action === 'customise') {
      opener = target;
      api.open();
      return;
    }
    if (action === 'save') {
      const picked: Partial<ConsentChoices> = {};
      dialog?.querySelectorAll<HTMLInputElement>('input[data-marvin-consent-category]').forEach((input) => {
        picked[input.dataset.marvinConsentCategory as ConsentCategoryName] = input.checked;
      });
      api.set(picked);
    } else {
      opener = target;
      choose(action === 'accept');
    }
    closeDialog();
  });
  dialog?.addEventListener('close', focusAfter);

  win.marvinConsent = api;
  record = read();
  if (record) {
    activate();
    // Listeners attached during page load (later module scripts) must not miss the initial event.
    win.setTimeout(() => {
      emit(true);
      loadEmbeds();
    }, 0);
  } else if (bar) {
    bar.hidden = false;
  }
  return api;
}
