# Quick start

## Install

```bash
npm install ekolite
```

Five entry points, everything else stays internal for now:

<!-- ekohacks:entry-points -->

```ts
import { App } from 'ekolite'; // the server framework
import { ConnectionManager } from 'ekolite/client'; // the browser client stack
import { useSubscription } from 'ekolite/react'; // the React binding (React 18+, optional peer)
import { defineConfig } from 'ekolite/config'; // the runner's config schema (ekolite.config.ts)
import type { ReadyMsg } from 'ekolite/shared'; // the wire protocol types

const app = App.createNull();
app.methods.define('greet', (name) => `hello ${String(name)}`);
await app.methods.call('greet', ['world']); // 'hello world'
```

<!-- /ekohacks:entry-points -->

`App.createNull()` assembles the whole graph in memory, so you can exercise methods, publications and files without a running MongoDB. Swap it for `App.create({ mongoUri, fileDir, port })` to talk to the real thing.

What comes back is empty. `App` wires the infrastructure and stops, so `app.publications` and `app.methods` hold exactly what you put on them and nothing of EkoLite's own:

```ts
const app = App.create({ mongoUri, fileDir, port });

app.publications.define('tasks.mine', (p) => ({ collection: 'tasks', query: { owner: p.owner } }));
app.methods.define('addTask', (title) => createTask(title));
```

To run your app as a server without writing a boot file, point an `ekolite.config.ts` at your definitions and use the `ekolite run` command. See [Running your app](/running-your-app).

## React

`ekolite/react` ships `useSubscription`, the hook that keeps a component in sync with a live server collection. It subscribes on mount, streams the collection's documents through `useSyncExternalStore`, reports loading, and unsubscribes on unmount:

```tsx
import { useSubscription } from 'ekolite/react';

function FileList({ connection }) {
  const { data, isLoading } = useSubscription(connection, 'files.all', 'files');
  if (isLoading) return <p>Loading</p>;
  return (
    <ul>
      {data.map((file) => (
        <li key={file._id}>{file.name}</li>
      ))}
    </ul>
  );
}
```

`connection` is your app's `ConnectionManager`. React 18+ is an optional peer dependency, so the other entries stay framework agnostic.

## Where next

- [Running your app](/running-your-app). Boot your own app with the `ekolite run` command.

- [Overview](/ekolite-overview/ekolite-overview) — what EkoLite is and how the pieces fit together.
- [System design](/ekolite-overview/ekolite-system-design) — how the framework is put together, and the wire protocol.
- [API reference](/api/connection-manager) — the client `ConnectionManager` and `SubscriptionHandle`.
