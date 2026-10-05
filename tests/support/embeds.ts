import type { MarvinEmbed } from '../../src/embeds.js';

export const YOUTUBE_URL = 'https://youtu.be/dQw4w9WgXcQ';
export const FACADE_HTML =
  '<figure class="marvin-embed marvin-embed--video marvin-embed--facade" data-provider="youtube">' +
  '<button type="button" class="marvin-embed__load">Load video</button></figure>';

/** A `PublishedEmbed` as core publishes it (click-to-load mode). */
export function youtubeEmbed(overrides: Partial<MarvinEmbed> = {}): MarvinEmbed {
  return {
    url: YOUTUBE_URL,
    canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    provider: 'youtube',
    providerName: 'YouTube',
    kind: 'video',
    status: 'ok',
    title: 'Never Gonna Give You Up',
    iframe: {
      src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      allow: 'encrypted-media; picture-in-picture; fullscreen',
      sandbox: 'allow-scripts allow-same-origin allow-presentation',
      referrerpolicy: 'strict-origin-when-cross-origin',
      aspectRatio: '16/9',
    },
    link: { href: YOUTUBE_URL, title: 'Never Gonna Give You Up', providerName: 'YouTube' },
    html: FACADE_HTML,
    ...overrides,
  };
}
