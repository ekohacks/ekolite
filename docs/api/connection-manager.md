# ConnectionManager

`ConnectionManager` is how a page talks to EkoLite. You hand it a connected
socket, subscribe to a publication by name, and read the documents back out of a
reactive store that stays in sync with the server.

It owns three things: the subscriptions you open, the per collection stores they
feed, and the teardown that runs when the socket closes.

## Worked example

This is the whole loop: create the socket, create the manager, subscribe, paint
the first frame, react to live updates, and stop on unmount.

```ts
import { ClientSocketWrapper } from '../../../client/clientSocket.ts';
import { ConnectionManager } from '../../../client/connectionManager.ts';

// A stand-in for whatever paints your UI. Declared so the example compiles
// without pulling in a framework.
declare function render(files: unknown[]): void;

const socket = ClientSocketWrapper.create('wss://app.example/ws');
await socket.connect();
const manager = new ConnectionManager(socket);

const handle = manager.subscribe('files.byFolder', { folderId: 'folder-a' });
await handle.ready;

const files = manager.store('files');
render(files.getAll()); // initial paint: the docs that arrived before ready
files.onChange(() => {
  render(files.getAll()); // subsequent live updates
});

// On unmount:
handle.stop();
```

> The imports use in repo paths because this snippet is a real source file the
> build typechecks (see [Keeping this honest](#keeping-this-honest)). From an
> installed package they resolve to the package entry points.

Line by line:

- `ClientSocketWrapper.create(url)` builds the client socket. It validates the
  URL is `ws://` or `wss://` but does not connect yet.
- `await socket.connect()` opens the connection and resolves once it is open, or
  rejects if it fails.
- `new ConnectionManager(socket)` wraps the socket. From here on you talk to the
  manager, not the socket. It starts listening for inbound messages and for the
  socket closing.
- `manager.subscribe('files.byFolder', { folderId: 'folder-a' })` sends a
  subscribe message and returns a [`SubscriptionHandle`](./subscription-handle.md)
  straight away. The second argument is the publication's params.
- `await handle.ready` resolves when the server has sent the initial documents
  and its `ready` signal. It rejects if the server returns an error for the
  subscription (for example an unknown publication).
- `manager.store('files')` returns the reactive store for the `files`
  collection. The collection name comes from the server, not from the
  subscription name. See the companion below.
- `render(files.getAll())` paints the documents that arrived before `ready`.
  This line matters: the initial batch lands in the store during `ready`, before
  `onChange` is registered, so without an explicit first render the page shows
  nothing until the next change.
- `files.onChange(...)` runs your callback on every later insert, update or
  remove the server forwards.
- `handle.stop()` unsubscribes. Call it when the component unmounts so the server
  stops sending you data you no longer render.

## The server side this talks to

Subscribing to `files.byFolder` does not, by itself, create a `files` store. The
client learns the collection name from the publication's `ready`, so the snippet
above only works against a matching publication on the server:

```ts
import { MongoWrapper } from '../../../server/infrastructure/mongo.ts';
import { Publications } from '../../../server/logic/publications.ts';
import { WebSocketWrapper } from '../../../server/infrastructure/websocket.ts';

// Wire the engine to your infrastructure, then declare the publication the
// client subscribes to. The collection it returns ('files') is the name the
// client's store binds to on ready, not the subscription name.
const publications = new Publications(
  MongoWrapper.create('mongodb://localhost:27017/app'),
  WebSocketWrapper.create(),
);

publications.define('files.byFolder', (params) => ({
  collection: 'files',
  query: { folderId: params?.folderId },
}));
```

`Publications` is the server side of this wire. It runs the query, sends the
initial documents and `ready`, then forwards live changes. Its reference is the
companion to this page.

## Lifecycle

The manager tears down on three triggers, all reaching the same single path,
`dispose()`:

- **Explicit `dispose()`** that you call yourself, for a deliberate teardown.
- **Socket close.** The manager observes the socket closing and disposes itself,
  so you do not have to.
- **Test teardown**, which is just the explicit call again, from a test's
  cleanup.

Once disposed, the manager stays inert. A `disposed` flag is consulted in three
places so a disposed manager can never come back to life: the inbound message
listener ignores any further messages, `store()` refuses to create a new store,
and `subscribe()` throws. Disposing also stops every open subscription and clears
the stores.

## Coming later

There is no reconnect yet. When the socket closes, the manager disposes and stays
disposed; nothing re establishes the connection or replays your subscriptions. If
you need to recover, create a fresh socket and manager and subscribe again.

Silent connection death (a socket that is open but dead) is being handled
separately by the socket heartbeat work, which is socket level and below this
surface.

The method registry and `call()` are not built yet either. When they land they
get their own page; they are not part of `ConnectionManager`.

## Keeping this honest

The two snippets on this page are copied verbatim from real source files under
`docs/api/__examples__/`, which the build typechecks against the actual codebase
through `npm run typecheck`. The day either API changes shape, the example stops
compiling and the PR that changed it owns this page.

## See also

- [`SubscriptionHandle`](./subscription-handle.md) — what `subscribe` returns.
- `ReactiveStore` — the store behind `manager.store(...)`. Its own page, written
  separately.
- `Publications` (`server/logic/publications.ts`) — the server side of the wire.
