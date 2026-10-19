/** A published `site.privacy` payload (camelCase, as Marvin sends it). */
export function rawPrivacy(overrides: Record<string, unknown> = {}) {
  return {
    controller: {
      legalName: 'Mash & Burn Co.',
      contactEmail: 'privacy@example.com',
      address: '1 Workshop Lane, Raleigh, NC',
      euRepresentative: null,
      dpoEmail: null,
    },
    processors: [
      {
        name: 'Cloudflare',
        purpose: 'Hosting and delivery',
        dataCategories: ['IP address', 'request metadata'],
        region: 'US',
        transferBasis: 'EU-US Data Privacy Framework',
        dpaUrl: 'https://www.cloudflare.com/cloudflare-customer-dpa/',
        privacyUrl: 'javascript:alert(1)',
      },
    ],
    cookies: [
      { name: 'mb-theme', provider: 'This site', purpose: 'Remembers light/dark', duration: 'Persistent', category: 'necessary' },
      { name: '_ga*', provider: 'Google', purpose: 'Counts visits', duration: '2 years', category: 'analytics' },
      { name: 'ads', provider: '<b>Ad Co</b>', purpose: 'Ads & "tracking"', duration: '30 days', category: 'marketing' },
    ],
    consent: { policyEntrySlug: 'privacy', lastReviewed: '2026-10-01' },
    ...overrides,
  };
}

export const NECESSARY_ONLY = [
  { name: 'mb-theme', provider: 'This site', purpose: 'Remembers light/dark', duration: 'Persistent', category: 'necessary' },
];
