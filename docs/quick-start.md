# Quick start

## Install

```bash
npm install ekolite
```

Three entry points, everything else stays internal for now:

```ts
import { App } from 'ekolite'; // the server framework
import { ConnectionManager } from 'ekolite/client'; // the browser client stack
import type { ReadyMsg } from 'ekolite/shared'; // the wire protocol types

const app = App.createNull();
app.methods.define('greet', (name) => `hello ${String(name)}`);
await app.methods.call('greet', ['world']); // 'hello world'
```

`App.createNull()` assembles the whole graph in memory, so you can exercise methods, publications and files without a running MongoDB. Swap it for `App.create(config)` to talk to the real thing.

## Where next

- [Overview](/ekolite-overview/ekolite-overview) — what EkoLite is and how the pieces fit together.
- [System design](/ekolite-overview/ekolite-system-design) — how the framework is put together, and the wire protocol.
- [API reference](/api/connection-manager) — the client `ConnectionManager` and `SubscriptionHandle`.
