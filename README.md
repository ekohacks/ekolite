# EkoLite

[![npm](https://img.shields.io/npm/v/ekolite)](https://www.npmjs.com/package/ekolite)
[![CI](https://github.com/ekohacks/ekolite/actions/workflows/ci.yml/badge.svg)](https://github.com/ekohacks/ekolite/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/ekolite)](./LICENSE)
[![docs](https://img.shields.io/badge/docs-ekohacks.github.io-blue)](https://ekohacks.github.io/ekolite/)

A lightweight, real time backend framework. Fastify, MongoDB and WebSocket with a typed pub/sub protocol, built test first with James Shore's Nullables pattern. No mocks anywhere in the suite.

EkoLite is a public, work in progress framework for real time, data driven apps, built in the open with deliberate design choices. The documents in [`docs/ekolite-overview/`](docs/ekolite-overview/) cover the thinking. This README covers what is actually built today.

Full docs: <https://ekohacks.github.io/ekolite/>

## Status

Work in progress, published early at `0.x` to claim the name and share the shape. The public API is still settling and can change between `0.x` releases, so pin a version and read the [release notes](https://github.com/ekohacks/ekolite/releases) before upgrading. Not recommended for production yet.

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
```

<!-- /ekohacks:entry-points -->

## What works today

- **Nullable infrastructure wrappers**, each with `create()` and `createNull()` factories: MongoDB (`MongoWrapper`), WebSocket server (`WebSocketWrapper`), file storage (`FileStorageWrapper`) and script runner (`ScriptRunnerWrapper`)
- **App wiring** (`App`): `App.create()` assembles the whole graph (Mongo, websocket, publications, methods, files) and `App.createNull()` returns the same graph in memory, so the assembly that boots in production is the one the tests drive
- **Pub/sub engine** (`Publications`): define a publication on the server, subscribe over a live socket, receive `ready` and data messages, with reference counted teardown. Wired end to end now: a real browser client subscribes over a real socket and its store fills from Mongo
- **RPC methods** (`Methods`): register a named server method, call it over the socket, and get a typed result or a structured error back through the `method` / `result` / `error` messages
- **File storage over HTTP** (`Files`): `POST /api/files` saves the bytes and inserts a document that streams into the live list through pub/sub; `GET /api/files/:id` streams them back. `allowedExtensions` in `ekolite.config.ts` says what may be uploaded; leave it out and the default is `.bam` alone, so widening is something a project asks for rather than something an upgrade hands it
- **Client stack**: `ClientSocketWrapper` (nullable WebSocket client), `ConnectionManager` (subscription lifecycle) and `ReactiveStore` (client side collection state)
- **React binding** (`ekolite/react`): `useSubscription(connection, name, collection)` keeps a component in sync with a live collection through `useSyncExternalStore`, returning `{ data, isLoading }`. React 18+ is an optional peer dependency, so the other entries stay framework agnostic
- **Mini DDP protocol** ([`shared/protocol.ts`](shared/protocol.ts)): eleven message types, typed end to end
- **Heartbeat and reconnect** (`ping` / `pong`): a socket can die while both ends still think it is open, so the client pings and closes a connection that stops answering, then reopens it: instant first retry, exponential backoff with jitter, capped, forever. Subscriptions replay with their original ids and each store swaps to the fresh documents in one move, so the page never renders empty in between. On by default with 15 second pings and a 10 second pong window; `reconnect: false` or a zero interval opts out, and `status` reports connecting / connected / reconnecting / closed
- **Graceful shutdown** (`Shutdown`): on a stop signal, or a shutdown message from a supervisor, it stops taking requests, closes the streams, drops the database connection, and exits cleanly
- **Runnable boot** (`start.ts`): wires real Mongo, websocket, publications, methods and file store through `App.create` and serves it over Fastify. It boots a bare server with nothing defined on it; a developer adds their own publications, methods and client on top, the way `meteor run` boots your app rather than one of ours

## What is planned, not yet built

- Auth on the HTTP routes. The file routes are open today.

## Quick start

You need Node 24 or newer, `"type": "module"` in your `package.json`, `moduleResolution` set to `nodenext` in your `tsconfig.json`, and MongoDB running as a replica set. That last one is not optional: publications are built on change streams, and a standalone `mongod` connects fine and then never sends you an update.

Write your publications and methods in an app entry. Reading is EkoLite's job, writing is yours, so bring the `mongodb` driver for the writes:

```ts
// app.ts
import type { AppEntry } from 'ekolite/config';
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URI ?? 'mongodb://localhost:27017/ekolite');
const tasks = client.db().collection('tasks');

const app: AppEntry = (eko) => {
  eko.publications.define('tasks.all', () => ({ collection: 'tasks', query: {} }));

  eko.methods.define('addTask', async (title) => {
    const result = await tasks.insertOne({ title: String(title) });
    return result.insertedId.toString();
  });
};

export default app;
```

Point the runner at it, and run it:

```ts
// ekolite.config.ts
import { defineConfig } from 'ekolite/config';

export default defineConfig({ app: './app.ts', clientDir: './public' });
```

```bash
npx ekolite run
# ekolite: ready on http://localhost:3001
```

Then subscribe from the browser and the store stays in sync on its own:

```ts
import { ClientSocketWrapper, ConnectionManager } from 'ekolite/client';

const socket = ClientSocketWrapper.create('ws://localhost:3001/ws');
await socket.connect();
const connection = new ConnectionManager(socket);

const handle = connection.subscribe('tasks.all');
await handle.ready;

const tasks = connection.store('tasks');
render(tasks.getAll());
tasks.onChange(() => render(tasks.getAll()));
```

The [full quick start](https://ekohacks.github.io/ekolite/quick-start.html) walks all of this end to end, including getting a replica set up, the React binding, file uploads and wiring the server by hand.

### Testing your app without MongoDB

`App.createNull()` assembles the whole graph in memory. No Mongo, no socket, no ports, so your tests exercise methods, publications and files at full speed:

```ts
import { App } from 'ekolite';

const app = App.createNull();
app.methods.define('greet', async (name) => `hello ${String(name)}`);
await app.methods.call('greet', ['world']); // 'hello world'
```

Note that `app.methods.call` takes its arguments as an array on the server, while the client's `connection.call` is variadic.

## Project structure

```
ekolite/
├── server/
│   ├── index.ts                  # createServer: Fastify, optional static, websocket, pub/sub + file routes
│   ├── start.ts                  # Runnable entry: boots App.create over Fastify
│   ├── infrastructure/
│   │   ├── mongo.ts              # MongoWrapper, create() / createNull()
│   │   ├── websocket.ts          # WebSocketWrapper, create() / createNull()
│   │   ├── fileStorage.ts        # FileStorageWrapper
│   │   ├── scriptRunner.ts       # ScriptRunnerWrapper
│   │   └── outputTracker.ts      # EventEmitter + OutputTracker
│   └── logic/
│       ├── publications.ts       # Pub/sub engine
│       └── files.ts              # Files: upload and read over storage + Mongo
├── client/
│   ├── index.ts                  # Public client surface (ekolite/client)
│   ├── clientSocket.ts           # ClientSocketWrapper, nullable WebSocket client
│   ├── connectionManager.ts      # Subscriptions and lifecycle
│   └── reactiveStore.ts          # Client side collection state
├── shared/
│   ├── protocol.ts               # Mini DDP message types
│   └── types.ts                  # Shared type definitions
└── tests/
    ├── infrastructure/           # Nullable unit tests + narrow integration tests
    ├── logic/                    # Sociable tests on nulled infrastructure
    ├── client/                   # Client side tests
    └── server/                   # Server integration tests
```

## Mini DDP protocol

Eleven message types, against roughly fifteen in full DDP. The saving is less in the count than in what is absent: no connect handshake, no session identity, no merge box, no latency compensation.

```
Client → Server:
  { type: 'subscribe', id, name, params? }
  { type: 'unsubscribe', id }
  { type: 'method', id, name, params }      // handled by the method registry
  { type: 'ping', id? }                     // heartbeat

Server → Client:
  { type: 'ready', id, collection }
  { type: 'added' | 'changed' | 'removed', collection, id, fields? }
  { type: 'result' | 'error', id, ... }
  { type: 'pong', id? }
```

## Working on this repo

Cloning EkoLite itself rather than using it:

```bash
npm install

npm run dev:server   # the repo's bare server on port 3001, auto restart

npm run typecheck
npm test
```

`npm run dev:server` boots a server with nothing defined on it, which is what you want when you are working on the framework and not on an app.

`npm run test:package` verifies the packaged shape from a consumer's point of view: it builds, packs, installs the tarball into a throwaway project outside this repo, and imports from the framework-agnostic entries. It does a real `npm install`, so it takes 30 to 60 seconds and runs as a manual gate rather than on every CI push.

## Testing

Built with [Testing Without Mocks](https://www.jamesshore.com/v2/projects/nullables/testing-without-mocks) (the Nullables pattern). Every infrastructure wrapper has `create()` and `createNull()` factories, and tests assert on state and `OutputTracker` output. No mocking libraries, just vitest.

```bash
npm test                  # Fast suite: nullable unit + sociable tests
npm run test:watch        # The same, on every save
npm run test:integration  # Narrow integration tests (needs a real local MongoDB)
```

Nullable unit tests and integration tests live in separate files (`x.test.ts` and `x.integration.test.ts`), so the fast suite never touches the network or disk.

## How we work

Strict TDD, red then green then refactor, with commit messages that show the loop (`test: red - ...`, `test: green - ...`, `refactor: ...`). Trunk based development: every branch comes off `main` and goes back via a small PR. The test suite is the safety net that makes that pace honest.

## Production build

```bash
npm run build   # tsc + declaration rewrite
npm start       # node dist/server/start.js
```

## License

[MIT](LICENSE)
