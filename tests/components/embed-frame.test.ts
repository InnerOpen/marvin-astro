import { describe, expect, it } from 'vitest';
import {
  activateEmbedFacade,
  frameHostPattern,
  iframeAttributes,
  installEmbedLoader,
  isAllowedFrameSrc,
  safeLinkHref,
} from '../../src/components/embed-frame.js';

const SRC = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
const HOSTS = ['www.youtube-nocookie.com'];

describe('frameHostPattern', () => {
  it('reduces CSP-style sources to a host', () => {
    expect(frameHostPattern('https://www.youtube-nocookie.com')).toBe('www.youtube-nocookie.com');
    expect(frameHostPattern('player.vimeo.com:443')).toBe('player.vimeo.com');
    expect(frameHostPattern('https://*.bandcamp.com/EmbeddedPlayer')).toBe('*.bandcamp.com');
    expect(frameHostPattern('W.SoundCloud.com')).toBe('w.soundcloud.com');
  });

  it('rejects anything that is not a host', () => {
    for (const bad of ["'self'", '*', '', 'https://', 'exa mple.com', 42, null]) {
      expect(frameHostPattern(bad), String(bad)).toBeUndefined();
    }
  });
});

describe('isAllowedFrameSrc', () => {
  it('allows https on a listed host', () => {
    expect(isAllowedFrameSrc(SRC, HOSTS)).toBe(true);
    expect(isAllowedFrameSrc(SRC, ['https://www.youtube-nocookie.com'])).toBe(true);
  });

  it('refuses hosts that are not listed, including look-alikes', () => {
    for (const src of [
      'https://evil.example/embed',
      'https://www.youtube-nocookie.com.evil.example/embed',
      'https://evil-www.youtube-nocookie.com/embed',
      'https://youtube-nocookie.com/embed',
    ]) {
      expect(isAllowedFrameSrc(src, HOSTS), src).toBe(false);
    }
  });

  it('refuses non-https schemes, credentials and junk', () => {
    for (const src of [
      'http://www.youtube-nocookie.com/embed/x',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'https://user:pass@www.youtube-nocookie.com/embed/x',
      '//www.youtube-nocookie.com/embed/x',
      'not a url',
      undefined,
    ]) {
      expect(isAllowedFrameSrc(src, HOSTS), String(src)).toBe(false);
    }
  });

  it('matches a wildcard against subdomains only', () => {
    expect(isAllowedFrameSrc('https://artist.bandcamp.com/x', ['*.bandcamp.com'])).toBe(true);
    expect(isAllowedFrameSrc('https://bandcamp.com/x', ['*.bandcamp.com'])).toBe(false);
    expect(isAllowedFrameSrc('https://evilbandcamp.com/x', ['*.bandcamp.com'])).toBe(false);
  });

  it('refuses everything when no hosts are given', () => {
    expect(isAllowedFrameSrc(SRC, [])).toBe(false);
  });
});

describe('iframeAttributes', () => {
  it('keeps only allow-listed attributes', () => {
    const attrs = iframeAttributes(
      {
        src: SRC,
        title: 'A video',
        allow: 'fullscreen',
        sandbox: 'allow-scripts allow-same-origin',
        referrerPolicy: 'strict-origin-when-cross-origin',
        loading: 'lazy',
        style: 'aspect-ratio: 16/9',
        srcdoc: '<script>alert(1)</script>',
        onload: 'alert(1)',
        name: 'x',
        allowfullscreen: true,
      },
      HOSTS
    );

    expect(attrs).toEqual({
      src: SRC,
      title: 'A video',
      allow: 'fullscreen',
      sandbox: 'allow-scripts allow-same-origin',
      referrerpolicy: 'strict-origin-when-cross-origin',
      loading: 'lazy',
      style: 'aspect-ratio: 16/9',
    });
  });

  it('refuses a src whose host is not allowed', () => {
    expect(iframeAttributes({ src: 'https://evil.example/x', title: 't' }, HOSTS)).toBeUndefined();
  });

  it('falls back to data-marvin-embed-src, still host-checked', () => {
    expect(iframeAttributes({ title: 't' }, HOSTS, SRC)?.src).toBe(SRC);
    expect(iframeAttributes({ title: 't' }, HOSTS, 'https://evil.example/x')).toBeUndefined();
  });

  it('drops a style that could load or inject anything', () => {
    for (const style of [
      'background:url(https://evil.example/t.png)',
      'width:expression(alert(1))',
      '@import "x"',
      'x:"\\3c script"',
    ]) {
      expect(iframeAttributes({ src: SRC, style }, HOSTS)?.style, style).toBeUndefined();
    }
  });

  it('drops non-scalar values and gives the iframe a title', () => {
    const attrs = iframeAttributes({ src: SRC, title: { toString: () => 'x' }, allow: ['a'] }, HOSTS);
    expect(attrs).toEqual({ src: SRC, title: 'Embedded media' });
  });

  it('refuses attrs that are not an object', () => {
    for (const bad of [undefined, null, 'src', [SRC]]) {
      expect(iframeAttributes(bad, HOSTS, SRC)).toBeUndefined();
    }
  });
});

describe('safeLinkHref', () => {
  it('passes http(s) and refuses other schemes', () => {
    expect(safeLinkHref('https://youtu.be/x')).toBe('https://youtu.be/x');
    expect(safeLinkHref('javascript:alert(1)')).toBeUndefined();
    expect(safeLinkHref('/relative')).toBeUndefined();
  });
});

// A minimal DOM: enough to watch the loader build and place the iframe. The repo has no
// DOM test environment, and this keeps the loader's contract explicit.
class FakeElement {
  attributes = new Map<string, string>();
  classes = new Set<string>();
  replacedWith: FakeElement | undefined;
  focused = false;
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
  };

  constructor(
    public tag: string,
    public parent?: FakeElement
  ) {}

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  closest(selector: string): FakeElement | null {
    if (selector === '.marvin-embed') return this.parent ?? null;
    return this.tag === 'button' ? this : (this.parent?.closest(selector) ?? null);
  }
  replaceWith(node: FakeElement) {
    this.replacedWith = node;
  }
  focus() {
    this.focused = true;
  }
}

function facade(attrs: unknown, hosts: unknown = HOSTS) {
  const figure = new FakeElement('figure');
  figure.classes.add('marvin-embed').add('marvin-embed--facade');
  const button = new FakeElement('button', figure);
  button.setAttribute('data-marvin-embed-attrs', JSON.stringify(attrs));
  button.setAttribute('data-marvin-embed-hosts', JSON.stringify(hosts));
  return { figure, button };
}

const fakeDocument = () => {
  const listeners: ((event: { target: unknown; preventDefault(): void }) => void)[] = [];
  return {
    created: [] as FakeElement[],
    createElement(tag: string) {
      const element = new FakeElement(tag);
      this.created.push(element);
      return element;
    },
    addEventListener(_type: string, listener: (typeof listeners)[number]) {
      listeners.push(listener);
    },
    listeners,
  };
};

describe('activateEmbedFacade', () => {
  it('replaces the button with an iframe built from the allow-listed attributes', () => {
    const doc = fakeDocument();
    const { figure, button } = facade({ src: SRC, title: 'A video', onload: 'alert(1)' });

    const iframe = activateEmbedFacade(
      button as unknown as Element,
      doc as unknown as Document
    ) as unknown as FakeElement;

    expect(iframe.tag).toBe('iframe');
    expect(Object.fromEntries(iframe.attributes)).toEqual({ src: SRC, title: 'A video' });
    expect(button.replacedWith).toBe(iframe);
    expect(iframe.focused).toBe(true);
    expect(figure.classes.has('marvin-embed--loaded')).toBe(true);
    expect(figure.classes.has('marvin-embed--facade')).toBe(false);
  });

  it('refuses a src outside the facade hosts and leaves the link in place', () => {
    const doc = fakeDocument();
    const { figure, button } = facade({ src: 'https://evil.example/x' });

    expect(activateEmbedFacade(button as unknown as Element, doc as unknown as Document)).toBeNull();
    expect(doc.created).toHaveLength(0);
    expect(button.replacedWith).toBeUndefined();
    expect(button.getAttribute('disabled')).toBe('');
    expect(figure.classes.has('marvin-embed--blocked')).toBe(true);
  });

  it('refuses malformed JSON', () => {
    const doc = fakeDocument();
    const { button } = facade({ src: SRC });
    button.setAttribute('data-marvin-embed-hosts', '[not json');

    expect(activateEmbedFacade(button as unknown as Element, doc as unknown as Document)).toBeNull();
  });
});

describe('installEmbedLoader', () => {
  it('adds one delegated listener per document that activates clicked facades', () => {
    const doc = fakeDocument();
    installEmbedLoader(doc as unknown as Document);
    installEmbedLoader(doc as unknown as Document);
    expect(doc.listeners).toHaveLength(1);

    const { button } = facade({ src: SRC, title: 'A video' });
    const label = new FakeElement('span', button);
    let prevented = false;
    doc.listeners[0]({ target: label, preventDefault: () => (prevented = true) });

    expect(prevented).toBe(true);
    expect(button.replacedWith?.tag).toBe('iframe');
  });

  it('ignores clicks outside a facade', () => {
    const doc = fakeDocument();
    installEmbedLoader(doc as unknown as Document);
    let prevented = false;
    doc.listeners[0]({ target: { closest: () => null }, preventDefault: () => (prevented = true) });
    doc.listeners[0]({ target: null, preventDefault: () => (prevented = true) });

    expect(prevented).toBe(false);
    expect(doc.created).toHaveLength(0);
  });
});
