import { describe, expect, it } from 'vitest';
import { createMarvinContent } from '../src/index.js';
import { createFakeClient, quietLogger } from './support/fakeClient.js';
import { referenceRead } from './support/fixtures.js';
import type { MarvinEntry } from '@inneropen/marvin-sdk';

const CONNECTION = {
  apiUrl: 'http://marvin.test',
  siteClientToken: 'site_client_test',
  workspaceSlug: 'test-workspace',
  logger: quietLogger,
};

function landingWith(entries: Record<string, MarvinEntry>) {
  const fake = createFakeClient({ entries });
  return createMarvinContent({ ...CONNECTION, createClient: () => fake.client });
}

const PAGE_ENTRY = {
  slug: 'bench-notes',
  title: 'Bench Notes',
  summary: 'What the workshop is thinking about.',
  data: { body: 'Notes from the bench.\nWritten as they happen.' },
  assets: [
    { role: 'icon', asset: { assetType: 'svg', publicUrl: '/icon.svg' } },
    { role: 'hero', asset: { assetType: 'image', publicUrl: '/hero.jpg' } },
  ],
} as unknown as MarvinEntry;

describe('getSectionLanding', () => {
  it('resolves title, intro HTML and hero from a page entry', async () => {
    const marvin = landingWith({ 'bench-notes': PAGE_ENTRY });
    const landing = await marvin.getSectionLanding('bench-notes');

    expect(landing.title).toBe('Bench Notes');
    expect(landing.hero).toBe('/hero.jpg');
    expect(landing.introHtml).toContain('Notes from the bench.');
  });

  it('keeps authored line breaks in the intro', async () => {
    const marvin = landingWith({ 'bench-notes': PAGE_ENTRY });

    expect((await marvin.getSectionLanding('bench-notes')).introHtml).toContain('<br>');
  });

  it('matches the hero by exact role, not by position', async () => {
    // The icon is the entry's first asset; a loose role match would return it.
    const marvin = landingWith({ 'bench-notes': PAGE_ENTRY });

    expect((await marvin.getSectionLanding('bench-notes')).hero).not.toBe('/icon.svg');
  });

  it('falls back to the summary when there is no body', async () => {
    const marvin = landingWith({
      'bench-notes': { ...PAGE_ENTRY, data: {} } as unknown as MarvinEntry,
    });

    expect((await marvin.getSectionLanding('bench-notes')).introHtml).toContain(
      'What the workshop is thinking about.'
    );
  });

  it('returns an empty landing when the page entry does not exist', async () => {
    const marvin = landingWith({});

    expect(await marvin.getSectionLanding('nope')).toEqual({});
  });

  it('works against a real entry that has no hero asset', async () => {
    const marvin = landingWith({ faq: referenceRead });
    const landing = await marvin.getSectionLanding('faq');

    expect(landing.title).toBe('FAQ');
    expect(landing.hero).toBeUndefined();
    expect(landing.introHtml).toContain('Do You Release Collections?');
  });
});
