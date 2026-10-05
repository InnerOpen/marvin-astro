import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import Embed from '../../src/components/Embed.astro';
import EntryRenderer from '../../src/components/EntryRenderer.astro';
import FormRenderer from '../../src/components/FormRenderer.astro';
import LinkCard from '../../src/components/LinkCard.astro';
import ArticleRenderer from '../../src/components/renderers/ArticleRenderer.astro';
import PageRenderer from '../../src/components/renderers/PageRenderer.astro';
import { createMarkdownRenderer } from '../../src/markdown.js';
import type { RendererEntry } from '../../src/renderers/types.js';
import { FACADE_HTML, YOUTUBE_URL, youtubeEmbed } from '../support/embeds.js';

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const render = (component: Parameters<AstroContainer['renderToString']>[0], props: object) =>
  container.renderToString(component, { props: props as Record<string, unknown> });

function attr(html: string, name: string): string | undefined {
  const match = html.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1]
    ?.replaceAll('&#34;', '"')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

describe('Embed', () => {
  it('renders a click-to-load facade by default, with nothing loaded from the provider', async () => {
    const html = await render(Embed, { embed: youtubeEmbed() });

    expect(html).toContain('marvin-embed--facade');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('<button type="button" class="marvin-embed__load"');
    expect(html).toContain('Never Gonna Give You Up');
    expect(html).toContain('Loads content from YouTube.');
    expect(html).toContain('--marvin-embed-aspect: 16/9');
    expect(JSON.parse(attr(html, 'data-marvin-embed-hosts')!)).toEqual(['www.youtube-nocookie.com']);
    expect(JSON.parse(attr(html, 'data-marvin-embed-attrs')!)).toMatchObject({
      src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      sandbox: 'allow-scripts allow-same-origin allow-presentation',
      loading: 'lazy',
    });
    expect(html).toContain(`href="${YOUTUBE_URL}"`);
  });

  it('renders the iframe directly in direct mode', async () => {
    const html = await render(Embed, { embed: youtubeEmbed(), mode: 'direct' });

    expect(html).toContain('<iframe');
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('referrerpolicy="strict-origin-when-cross-origin"');
    expect(html).not.toContain('marvin-embed--facade');
  });

  it('uses the consent text with the provider filled in, and frame sources as hosts', async () => {
    const html = await render(Embed, {
      embed: youtubeEmbed(),
      consentText: 'Plays from {provider}; their cookies apply.',
      frameSources: ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
    });

    expect(html).toContain('Plays from YouTube; their cookies apply.');
    expect(JSON.parse(attr(html, 'data-marvin-embed-hosts')!)).toEqual([
      'https://www.youtube-nocookie.com',
      'https://player.vimeo.com',
    ]);
  });

  it('falls back to a link card when the iframe host is outside the frame sources', async () => {
    const html = await render(Embed, {
      embed: youtubeEmbed(),
      mode: 'direct',
      frameSources: ['https://player.vimeo.com'],
    });

    expect(html).not.toContain('<iframe');
    expect(html).toContain('class="marvin-embed-link"');
  });

  it('renders a link card for link/unavailable status', async () => {
    for (const status of ['link', 'unavailable']) {
      const html = await render(Embed, { embed: youtubeEmbed({ status, iframe: null }) });
      expect(html, status).toContain('class="marvin-embed-link"');
      expect(html, status).toContain('on YouTube');
      expect(html, status).toContain(`data-status="${status}"`);
      expect(html, status).not.toContain('<iframe');
    }
  });

  it('sizes audio by height', async () => {
    const html = await render(Embed, {
      embed: youtubeEmbed({
        kind: 'audio',
        iframe: { src: 'https://open.spotify.com/embed/track/1', title: 'Track', height: 152 },
      }),
      mode: 'direct',
    });

    expect(html).toContain('marvin-embed--audio');
    expect(html).toContain('--marvin-embed-height: 152px');
  });

  it('refuses a non-https iframe src and an injected size', async () => {
    const html = await render(Embed, {
      embed: youtubeEmbed({
        iframe: {
          src: 'javascript:alert(1)',
          title: 'x',
          aspectRatio: '16/9; background:url(https://evil.example)',
        },
      }),
      mode: 'direct',
    });

    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('evil.example');
  });

  it('renders nothing without an embed', async () => {
    expect((await render(Embed, { embed: undefined })).trim()).toBe('');
  });
});

describe('LinkCard', () => {
  it('renders title and provider from explicit props', async () => {
    const html = await render(LinkCard, {
      href: 'https://vimeo.com/1',
      title: 'A film',
      providerName: 'Vimeo',
    });

    expect(html).toContain('href="https://vimeo.com/1"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('A film');
    expect(html).toContain('on Vimeo');
  });

  it('renders nothing for a non-http link', async () => {
    expect((await render(LinkCard, { href: 'javascript:alert(1)' })).trim()).toBe('');
  });
});

function pageEntry(overrides: Partial<RendererEntry> = {}): RendererEntry {
  return {
    title: 'About',
    slug: 'about',
    entryType: 'page',
    data: { body: `## Hello\n\nSome **bold** text.\n\n${YOUTUBE_URL}` },
    collections: [],
    resources: [],
    assets: [],
    embeds: { [YOUTUBE_URL]: youtubeEmbed() },
    ...overrides,
  } as RendererEntry;
}

describe('Page and Article renderers', () => {
  for (const [name, component] of [
    ['PageRenderer', PageRenderer],
    ['ArticleRenderer', ArticleRenderer],
  ] as const) {
    it(`${name} renders the markdown body as HTML, with embeds`, async () => {
      const html = await render(component, { entry: pageEntry() });

      expect(html).toContain('<h2>Hello</h2>');
      expect(html).toContain('<strong>bold</strong>');
      expect(html).not.toContain('## Hello');
      expect(html).toContain(FACADE_HTML);
    });
  }

  it('uses the site’s markdown renderer when given', async () => {
    const html = await render(PageRenderer, {
      entry: pageEntry({ data: { body: 'one\ntwo' }, embeds: undefined }),
      renderMarkdown: createMarkdownRenderer({ breaks: true }),
    });

    expect(html).toContain('one<br>two');
  });
});

describe('EntryRenderer', () => {
  const info = (pkg: string) => ({
    slug: 'page',
    renderer: 'page',
    package: pkg,
    publishable: true,
    submittable: false,
    routable: true,
  });

  it('renders core entry types declared under either package name', async () => {
    for (const pkg of ['@inneropen/marvin-renderers-core', '@inneropen/marvin-astro']) {
      const html = await render(EntryRenderer, { entry: pageEntry({ entryTypeInfo: info(pkg) }) });
      expect(html, pkg).toContain('data-renderer="page"');
    }
  });

  it('leaves an entry from another renderer package to the slot', async () => {
    const html = await render(EntryRenderer, {
      entry: pageEntry({ entryTypeInfo: info('@inneropen/marvin-renderers-youtube') }),
    });

    expect(html).not.toContain('data-renderer');
  });
});

describe('FormRenderer', () => {
  it('renders fields from the form schema', async () => {
    const html = await render(FormRenderer, {
      action: '/api/forms/newsletter',
      honeypotField: 'website',
      schema: {
        fields: [
          { key: 'email', label: 'Email', type: 'text', required: true },
          { key: 'topic', label: 'Topic', type: 'select', options: ['A', 'B'] },
        ],
      },
    });

    expect(html).toContain('action="/api/forms/newsletter"');
    expect(html).toContain('type="email"');
    expect(html).toContain('name="website"');
    expect(html).toContain('<option value="B">B</option>');
  });
});
