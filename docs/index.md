---
layout: home
hero:
  name: EkoLite
  text: A real time backend framework for data driven apps
  tagline: Fastify, MongoDB and WebSocket with a typed pub/sub protocol. Built test first with James Shore's Nullables pattern, no mocks anywhere in the suite.
  actions:
    - theme: brand
      text: Quick start
      link: /quick-start
    - theme: alt
      text: Overview
      link: /ekolite-overview/ekolite-overview
    - theme: alt
      text: View on npm
      link: https://www.npmjs.com/package/ekolite
features:
  - title: Typed pub/sub
    details: Define a publication, subscribe over a live socket, and a reactive store fills from MongoDB change streams.
  - title: RPC methods
    details: Register a named server method, call it over the socket, and get a typed result or a structured error back.
  - title: Nullable infrastructure
    details: Every wrapper ships create() and createNull(), so the whole graph runs in memory for tests. No mocks, no spies.
---

## Status

EkoLite is public and a work in progress, published early at `0.x` to claim the name and share the shape. The public API is still settling and can change between `0.x` releases, so pin a version and read the [release notes](https://github.com/ekohacks/ekolite/releases) before upgrading. Not recommended for production yet.
