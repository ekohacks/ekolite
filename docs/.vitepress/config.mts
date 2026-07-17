import { defineConfig } from 'vitepress';

// EkoLite documentation site. Root is docs/, so the page links below are relative to it.
//
// Excluded from the build: the internal planning docs. Epics is the roadmap and customer is
// a stakeholder brief, so neither is a framework document and neither goes public. Everything
// else in ekolite-overview/ is published.
export default defineConfig({
  title: 'EkoLite',
  description:
    'A lightweight, real-time backend framework: Fastify, MongoDB and WebSocket with typed pub/sub, RPC methods and file uploads.',
  base: '/ekolite/',
  // Not published. Epics is the roadmap and customer is a stakeholder brief, so neither is a
  // framework document. The spec is the original design target: it documents definePublication,
  // defineMethod and defineUploadHandler, none of which were built. The API that exists is
  // documented in api/ and in the system design guide, so publishing the spec would only teach
  // a reader calls they cannot make. It stays in the repo as the record of what was intended.
  srcExclude: [
    'ekolite-overview/ekolite-epics.md',
    'ekolite-overview/ekolite-customer.md',
    'ekolite-overview/ekolite-spec.md',
    'archive/**',
  ],
  themeConfig: {
    nav: [
      { text: 'Quick start', link: '/quick-start' },
      { text: 'Run your app', link: '/running-your-app' },
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
          { text: 'Running your app', link: '/running-your-app' },
        ],
      },
      {
        text: 'Design',
        items: [
          { text: 'System design', link: '/ekolite-overview/ekolite-system-design' },
          { text: 'Architecture decisions', link: '/ekolite-overview/ekolite-adrs' },
        ],
      },
      {
        text: 'Manual',
        items: [
          { text: 'Test-driven development', link: '/ekolite-overview/ekolite-tdd-training' },
          { text: 'TDD engineering guide', link: '/ekolite-overview/ekolite-tdd' },
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
