# EkoLite, System Design

Start with [ekolite-overview.md](ekolite-overview.md) for the big picture, and the [API reference](../api/connection-manager.md) for the client signatures. This document explains how the framework is put together and why it is shaped the way it is. The decisions behind it are recorded in [ekolite-adrs.md](ekolite-adrs.md).

---

## 1. The Shape of the Framework

EkoLite splits into three layers, and the split is the whole design.

**Infrastructure** reaches outside the process: MongoDB, the WebSocket server, the file system, child processes. Each one is a wrapper with two factories, `create()` for the real thing and `createNull()` for an in-memory stand-in behind the same interface.

**Logic** is everything that decides something: which documents a subscription sends, what a method returns, whether a file is acceptable. Logic classes never import infrastructure. They receive it through the constructor, and they cannot tell a real wrapper from a nulled one.

**The application layer** wires the two together. `App.create(config)` assembles real infrastructure. `App.createNull()` assembles the same graph with nulled infrastructure. The assembly that boots in production is the assembly the tests drive, which is the point: there is no separate test wiring to drift out of step.

```
server/
  infrastructure/     mongo.ts, websocket.ts, fileStorage.ts, scriptRunner.ts, process.ts
  logic/              publications.ts, methods.ts, rpcHandler.ts, files.ts, shutdown.ts
  app.ts              App.create() / App.createNull()
  index.ts            createServer(): Fastify, static, websocket routing, file routes
client/
  clientSocket.ts     ClientSocketWrapper, the nullable WebSocket client
  connectionManager.ts  subscriptions, remote calls, lifecycle
  reactiveStore.ts    client-side collection state
  uploader.ts         file upload with progress
shared/
  protocol.ts         the wire protocol, typed for both ends
```

What `App` does not do is define anything. It wires infrastructure into logic and stops, so the registries it hands back are empty and whatever you define is all that is on them. The framework carries no publications or methods of its own, the way `meteor run` boots your app rather than one of ours.

---

## 2. The Wire Protocol

The protocol is called Mini DDP. It is deliberately small, and `shared/protocol.ts` is the only place it is defined, imported by both halves so a message that changes shape breaks the build rather than a user's session.

### 2.1 The Messages

```
Client → Server:
  { type: 'subscribe', id, name, params? }   request a publication
  { type: 'unsubscribe', id }                stop receiving it
  { type: 'method', id, name, params }       call a server method
  { type: 'ping', id? }                      are you still there

Server → Client:
  { type: 'ready', id, collection }          initial documents sent
  { type: 'added', collection, id, fields? }
  { type: 'changed', collection, id, fields? }
  { type: 'removed', collection, id }
  { type: 'result', id, result }             the method returned
  { type: 'error', id, error }               the method failed
  { type: 'pong', id? }                      still here
```

Eleven message types, against roughly fifteen in full DDP.

### 2.2 What the Protocol Refuses to Do

The count is not really the point. The saving is in the machinery that is absent, and each absence is a decision.

| Not implemented      | What it would do                                     | Why it is not here                                                                                    |
| -------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Connect handshake    | Version negotiation before anything else             | The WebSocket `open` event already says the connection is up                                          |
| Session identity     | Track a client across reconnects                     | A client that reconnects re-subscribes, which is simpler than replaying a log                         |
| Merge box            | Reconcile documents across overlapping subscriptions | Subscriptions do not overlap in practice, and the bookkeeping is substantial                          |
| Latency compensation | Run the method on the client first, reconcile later  | Methods run server-side work, such as an analysis script. There is nothing to simulate optimistically |
| Reconnect replay     | Resume a dropped session where it left off           | The client reconnects and resubscribes from scratch (see 6.1), needing no session log to replay from  |

Reconnect itself is built now (see 6.1): a dropped socket reopens and resubscribes. What these two rows still refuse is a server-side session log to resume from, and full resubscribe is what makes it unnecessary.

### 2.3 The Heartbeat

`ping` and `pong` exist because a TCP connection can be dead while both ends still believe it is open. The socket does not close, no error fires, and the client sits waiting for data that will never arrive.

`ClientSocketWrapper` runs a `Heartbeat` that sends a `ping` on an interval and expects a `pong` before a deadline. If the deadline passes, the connection is treated as dead and closed, which is the only way the client finds out. The server answers every `ping` with a `pong`, carrying the `id` back when the ping sent one.

In the live client the heartbeat is on by default: `pingIntervalMs` is 15 seconds and `pongTimeoutMs` is 10 seconds (`DEFAULT_PING_INTERVAL_MS` and `DEFAULT_PONG_TIMEOUT_MS` in `client/clientSocket.ts`). Setting either to zero disables it. The silently dead socket the heartbeat catches is the first half of the connection lifecycle in 6.1: the close it forces is what the reconnect path acts on.

### 2.4 Flows

**Subscribe, then live updates:**

```
Client                                    Server
  │── subscribe(id:'s1',                    │
  │     name:'files.all') ────────────────►│
  │                                          │── query MongoDB
  │◄── added(collection:'files', id:'1') ──│
  │◄── ready(id:'s1', collection:'files') ─│
  │                                          │
  │      [someone uploads a file]            │
  │                                          │── change stream fires
  │◄── added(collection:'files', id:'2') ──│
```

**Call a method:**

```
Client                                    Server
  │── method(id:'m1', name:'runReport',    │
  │     params:['/uploads/x.csv']) ───────►│
  │                                          │── ScriptRunner runs the script
  │◄── result(id:'m1', result:'42') ───────│
```

**A method that fails:**

```
Client                                    Server
  │── method(id:'m2',                       │
  │     name:'doesNotExist') ─────────────►│
  │                                          │── no such method
  │◄── error(id:'m2', error:{code, message})│
```

---

## 3. Live Data

`Publications` is the pub/sub engine. A publication is a named function that returns the collection to watch and the query that selects from it:

```ts
publications.define('files.all', () => ({ collection: 'files', query: {} }));
```

When a client subscribes, the server runs the query, sends one `added` per document, then `ready`. From that point a MongoDB change stream feeds `added`, `changed` and `removed` to every subscriber as the data moves.

Teardown is reference counted. Several clients can hold the same publication, and the change stream is only closed when the last one lets go. A client that never unsubscribes is not a leak: closing the socket disposes its subscriptions.

Removals are bookkeeping-aware. The server tracks which documents each client actually holds, and only pushes a `removed` for a document that client knows about, so a client is never told to delete something it never had.

---

## 4. Remote Calls

`Methods` is a registry. A method is a named function on the server:

```ts
methods.define('runReport', async (path) => scriptRunner.exec('python3', [script, path]));
```

`RpcHandler` routes an inbound `method` message to the registry and sends back `result` or `error`. Failures come back as a structured error with a code and a message, not a stack trace, and the client rejects the pending promise with it.

---

## 5. Files

Files go over plain HTTP, not the socket.

`POST /api/files` takes a multipart upload, `Files.validate()` decides whether the name is acceptable, `FileStorageWrapper` writes the bytes, and a metadata document goes into MongoDB. That insert is what makes the file appear: the change stream picks it up and pub/sub streams it into every subscribed client's list. Upload and live update are the same mechanism, not two.

`GET /api/files/:id` streams the bytes back.

The routes are open. There is no auth on them yet, and that is a known gap.

---

## 6. The Client Stack

`ClientSocketWrapper` is the nullable WebSocket client: the same `create()` and `createNull()` pattern as the server wrappers, so client logic can be tested without a socket.

`ConnectionManager` is the surface a page actually uses:

```ts
const handle = connection.subscribe('files.all'); // → SubscriptionHandle
const store = connection.store('files'); // → ReactiveStore
const count = await connection.call('runReport', path);
handle.stop();
```

`ReactiveStore` is client-side collection state: a `Map` fed by `added`, `changed` and `removed`, with `getAll()`, `getById()` and `onChange()` for the UI to listen to. It is about ninety lines, and it holds no query engine on purpose.

`ConnectionManager.dispose()` stops every subscription and rejects every in-flight call, so a deliberately closed connection never leaves a promise hanging forever. A network drop is different: the manager survives it and resubscribes rather than disposing, and only a deliberate close tears it down (see 6.1).

### 6.1 The connection lifecycle

A dropped socket is not the end of the client. `ClientSocketWrapper` reopens it and `ConnectionManager` picks its subscriptions back up, so the page recovers on its own. Four rules shape what happens, and each is pinned by a test.

**A close carries intent.** Only the application calling `close()` is deliberate. A heartbeat that times out and a socket that dies on the network are not, and only those trigger reconnect. A deliberate close stays closed. (`deliberateClose` in `client/clientSocket.ts`, pinned by `clientSocket.reconnect.test.ts`.)

**Reconnect backs off and never gives up.** The first retry is instant. After that the wait doubles from 1 second (`reconnectBaseMs`) to a 30 second cap (`reconnectMaxMs`), spread by jitter of up to a quarter so a fleet of clients coming back together does not stampede the server. A live connection resets the schedule to the top, and it retries forever. `reconnect: false` opts out, and a drop then goes straight to closed. (`clientSocket.reconnect.test.ts`.)

**Resubscribe and catch up.** The manager survives the drop rather than disposing. On every reopen it replays each subscription with its original id. While a subscription revives, the documents that arrive buffer, and the `ready` after resubscribe swaps the store's contents in one move. So a document deleted during the outage is gone afterwards, the page keeps its stale view until the swap rather than flashing empty, and live updates resume once the catch up completes. (`connectionManager.catchUp.test.ts`.)

**`status` is what a page renders.** `ClientSocketWrapper.status` is one of `connecting`, `connected`, `reconnecting` or `closed`. `reconnecting` covers the whole outage, from the unexpected close to the socket coming back, so an application can render that state and hold the stale data on screen instead of hiding the failure. (`ConnectionStatus` in `client/clientSocket.ts`, pinned by `clientSocket.status.test.ts`.)

**A drop and recovery:**

```
Client                                    Server
  │  connected, subscribed to files.all      │
  │  store holds doc1, doc2                   │
  │                                           │
  │      [network dies, no close event]       │
  │  heartbeat pong times out → socket closed │
  │  status: reconnecting                     │
  │                                           │
  │  retry: instant, then 1s, 2s, 4s … 30s    │
  │── (reopened) ────────────────────────────►│
  │  status: connected                        │
  │── subscribe(id:'s1', name:'files.all') ──►│  same id as before
  │◄── added(collection:'files', id:'doc2') ──│  doc1 was deleted while away
  │◄── added(collection:'files', id:'doc3') ──│  incoming docs buffer
  │◄── ready(id:'s1', collection:'files') ────│  store swaps whole, doc1 gone
  │  the stale view is held until this ready,  │
  │  the store is never observed empty         │
```

---

## 7. How It Is Tested

Every infrastructure wrapper has `create()` and `createNull()`, and parity tests hold the two to the same behaviour. Logic is tested against nulled infrastructure, so the tests exercise real logic against substitutable edges rather than asserting that a mock was called. There is no mocking library in the project.

Nullable unit tests and integration tests live in separate files, so the fast suite never touches the network or the disk. The full pipeline, real Mongo, real socket, real upload, is covered by integration tests that run separately.

[nullables-how-much-should-the-stub-know.md](../manual/nullables-how-much-should-the-stub-know.md) works through the design question that comes up most: how much a nulled stub should know about the thing it stands in for.
