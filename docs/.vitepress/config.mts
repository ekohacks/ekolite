import { defineConfig } from 'vitepress';

// EkoLite documentation site. Root is docs/, so the page links below are relative to it.
//
// Excluded from the build: the internal planning docs (epics, customer), which stay
// private, and the design docs still being cleaned for public reading (system design,
// ADRs, the TDD guides). Those ship once that cleanup lands, tracked in EKO-304.
export default defineConfig({
  title: 'EkoLite',
  description:
    'A lightweight, real-time backend framework: Fastify, MongoDB and WebSocket with typed pub/sub, RPC methods and file uploads.',
  base: '/ekolite/',
  srcExclude: [
    'ekolite-overview/ekolite-epics.md',
    'ekolite-overview/ekolite-customer.md',
    'ekolite-overview/ekolite-system-design.md',
    'ekolite-overview/ekolite-adrs.md',
    'ekolite-overview/ekolite-tdd.md',
    'ekolite-overview/ekolite-tdd-training.md',
    'archive/**',
  ],
  themeConfig: {
    nav: [
      { text: 'Quick start', link: '/quick-start' },
      { text: 'Overview', link: '/ekolite-overview/ekolite-overview' },
      { text: 'API', link: '/api/connection-manager' },
      { text: 'npm', link: 'https://www.npmjs.com/package/ekolite' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Overview', link: '/ekolite-overview/ekolite-overview' },
          { text: 'Quick start', link: '/quick-start' },
          { text: 'Specification', link: '/ekolite-overview/ekolite-spec' },
        ],
      },
      {
        text: 'Manual',
        items: [
          {
            text: 'Nullables: how much should the stub know?',
            link: '/manual/nullables-how-much-should-the-stub-know',
          },
        ],
      },
      {
        text: 'API reference',
        items: [
          { text: 'ConnectionManager', link: '/api/connection-manager' },
          { text: 'SubscriptionHandle', link: '/api/subscription-handle' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/ekohacks/ekolite' }],
  },
});
