import { describe, expect, it } from 'vitest';
import {
  consentCategories,
  consentVersion,
  cookiesNeedConsent,
  sitePrivacy,
  type SitePrivacy,
} from '../src/privacy.js';
import { NECESSARY_ONLY, rawPrivacy } from './support/privacy.js';

describe('sitePrivacy', () => {
  it('normalizes the published camelCase payload', () => {
    const privacy = sitePrivacy(rawPrivacy())!;

    expect(privacy.controller).toEqual({
      legalName: 'Mash & Burn Co.',
      contactEmail: 'privacy@example.com',
      address: '1 Workshop Lane, Raleigh, NC',
      euRepresentative: undefined,
      dpoEmail: undefined,
    });
    expect(privacy.processors[0]).toMatchObject({
      name: 'Cloudflare',
      dataCategories: ['IP address', 'request metadata'],
      transferBasis: 'EU-US Data Privacy Framework',
    });
    expect(privacy.cookies.map((cookie) => cookie.category)).toEqual([
      'necessary',
      'analytics',
      'marketing',
    ]);
    expect(privacy.consent).toMatchObject({ policyEntrySlug: 'privacy', lastReviewed: '2026-10-01' });
  });

  it('also reads snake_case keys', () => {
    const privacy = sitePrivacy({
      controller: { legal_name: 'Acme', contact_email: 'a@example.com' },
      processors: [{ name: 'Mail', data_categories: ['email'], transfer_basis: 'SCCs', dpa_url: 'https://x.test/dpa' }],
      consent: { last_reviewed: '2026-01-02', cookie_policy_entry_slug: 'cookies' },
      banner_required: true,
    })!;

    expect(privacy.controller?.legalName).toBe('Acme');
    expect(privacy.processors[0]).toMatchObject({ dataCategories: ['email'], transferBasis: 'SCCs' });
    expect(privacy.consent).toMatchObject({ lastReviewed: '2026-01-02', cookiePolicyEntrySlug: 'cookies' });
    expect(privacy.bannerRequired).toBe(true);
  });

  it('returns undefined for absent or non-object input', () => {
    for (const bad of [undefined, null, 'privacy', 42, [], true]) {
      expect(sitePrivacy(bad), String(bad)).toBeUndefined();
    }
  });

  it('survives junk inside an otherwise valid object', () => {
    const privacy = sitePrivacy({
      controller: 'nobody',
      processors: [null, 'x', { purpose: 'no name' }, { name: 'Ok', dataCategories: [1, 'a', ''] }],
      cookies: [{ category: 'analytics' }, 7, { name: 'c', category: 'analytics' }],
      consent: 5,
    })!;

    expect(privacy.controller).toBeUndefined();
    expect(privacy.processors).toEqual([expect.objectContaining({ name: 'Ok', dataCategories: ['a'] })]);
    expect(privacy.cookies).toEqual([
      expect.objectContaining({ name: 'c', provider: '', purpose: '', category: 'analytics' }),
    ]);
    expect(privacy.consent).toEqual({
      policyEntrySlug: undefined,
      cookiePolicyEntrySlug: undefined,
      lastReviewed: undefined,
      version: undefined,
    });
  });

  it('treats an unknown category as marketing, never as necessary', () => {
    const privacy = sitePrivacy({ cookies: [{ name: 'x', category: 'telepathy' }] })!;
    expect(privacy.cookies[0]?.category).toBe('marketing');
    expect(privacy.bannerRequired).toBe(true);
  });

  it('computes bannerRequired when absent and trusts a boolean when present', () => {
    expect(sitePrivacy({ cookies: NECESSARY_ONLY })!.bannerRequired).toBe(false);
    expect(sitePrivacy({ cookies: [] })!.bannerRequired).toBe(false);
    expect(sitePrivacy(rawPrivacy())!.bannerRequired).toBe(true);
    expect(sitePrivacy(rawPrivacy({ bannerRequired: false }))!.bannerRequired).toBe(false);
    expect(sitePrivacy(rawPrivacy({ bannerRequired: 'yes' }))!.bannerRequired).toBe(true);
  });
});

describe('cookiesNeedConsent / consentCategories', () => {
  it('flags only non-necessary entries', () => {
    expect(cookiesNeedConsent([{ category: 'necessary' }])).toBe(false);
    expect(cookiesNeedConsent([{ category: 'necessary' }, { category: 'preferences' }])).toBe(true);
  });

  it('lists the optional categories present, in display order', () => {
    expect(consentCategories(sitePrivacy(rawPrivacy()))).toEqual(['analytics', 'marketing']);
    expect(consentCategories(undefined)).toEqual([]);
  });
});

describe('consentVersion', () => {
  const base = () => sitePrivacy(rawPrivacy())!;
  const edit = (change: (privacy: SitePrivacy) => void) => {
    const privacy = base();
    change(privacy);
    return consentVersion(privacy);
  };

  it('is 8 hex digits and stable', () => {
    expect(consentVersion(base())).toMatch(/^[0-9a-f]{8}$/);
    expect(consentVersion(base())).toBe(consentVersion(base()));
  });

  it('matches the FNV-1a of the sorted non-necessary triples', () => {
    // Hand-computed reference so a refactor can't silently re-prompt every visitor.
    expect(consentVersion(sitePrivacy({ cookies: [] }))).toBe('811c9dc5');
    const triple = sitePrivacy({
      cookies: [{ name: 'a', provider: 'p', category: 'analytics' }],
    });
    let hash = 0x811c9dc5;
    for (const char of 'analytics|a|p') hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
    expect(consentVersion(triple)).toBe((hash >>> 0).toString(16).padStart(8, '0'));
  });

  it('ignores order, wording, duration, necessary entries and lastReviewed', () => {
    const original = consentVersion(base());
    expect(edit((p) => p.cookies.reverse())).toBe(original);
    expect(edit((p) => { p.cookies[1]!.purpose = 'Totally different words'; })).toBe(original);
    expect(edit((p) => { p.cookies[1]!.duration = '1 day'; })).toBe(original);
    expect(edit((p) => { p.cookies[0]!.name = 'renamed-necessary'; })).toBe(original);
    expect(edit((p) => { p.consent.lastReviewed = '2030-01-01'; })).toBe(original);
    expect(edit((p) => { p.processors = []; })).toBe(original);
  });

  it('changes when a non-necessary cookie is added, removed, renamed, re-homed or re-categorised', () => {
    const original = consentVersion(base());
    expect(edit((p) => p.cookies.push({ name: 'new', provider: 'X', purpose: '', category: 'analytics' }))).not.toBe(original);
    expect(edit((p) => p.cookies.pop())).not.toBe(original);
    expect(edit((p) => { p.cookies[1]!.name = '_gid'; })).not.toBe(original);
    expect(edit((p) => { p.cookies[1]!.provider = 'Plausible'; })).not.toBe(original);
    expect(edit((p) => { p.cookies[1]!.category = 'marketing'; })).not.toBe(original);
  });

  it('changes with a manual consent.version bump', () => {
    const original = consentVersion(base());
    const bumped = edit((p) => { p.consent.version = '2'; });
    expect(bumped).not.toBe(original);
    expect(edit((p) => { p.consent.version = '3'; })).not.toBe(bumped);
  });
});
