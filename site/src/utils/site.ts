/**
 * Site-wide constants + the one base-path-aware URL helper.
 *
 * `u('/docs/quickstart/')` → '/lumen/docs/quickstart/' — every internal
 * link on the site goes through this so the Pages project base stays a
 * one-line change (BA-1). The G6 link gate treats `/lumen/…` as internal.
 */
export const BASE = import.meta.env.BASE_URL as string;

export const u = (path: string): string =>
  path.startsWith('/') ? `${BASE}${path}` : `${BASE}/${path}`;

export interface NavItem {
  readonly href: string;
  readonly title: string;
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const docsNav: readonly NavGroup[] = [
  {
    label: 'Start here',
    items: [{ href: '/docs/quickstart/', title: 'Quickstart' }],
  },
  {
    label: 'Guides',
    items: [
      { href: '/docs/mcp-onboarding/', title: 'MCP onboarding' },
      { href: '/docs/providers-byok/', title: 'Providers & BYOK' },
      { href: '/docs/configuration/', title: 'Configuration' },
    ],
  },
  {
    label: 'Reference',
    items: [
      { href: '/docs/cli-reference/', title: 'CLI reference' },
      { href: '/docs/rules-reference/', title: 'Audit rules' },
      { href: '/docs/attributions/', title: 'Attributions' },
    ],
  },
];
