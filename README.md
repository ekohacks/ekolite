# EkoLite

A lightweight, real time backend framework in the spirit of Meteor. Fastify, MongoDB and WebSocket with a typed pub/sub protocol, built test first with James Shore's Nullables pattern. No mocks anywhere in the suite.

EkoLite is a public, work in progress rebuild of Meteor's core ideas with deliberate differences. The documents in [`docs/ekolite-overview/`](docs/ekolite-overview/) cover the thinking. This README covers what is actually built today.

## What works today

- **Nullable infrastructure wrappers**, each with `create()` and `createNull()` factories: MongoDB (`MongoWrapper`), WebSocket server (`WebSocketWrapper`), file storage (`FileStorageWrapper`) and script runner (`ScriptRunnerWrapper`)
- **Pub/sub engine** (`Publications`): define a publication on the server, subscribe over the socket, receive `ready` and data messages, with reference counted teardown
- **Client stack**: `ClientSocketWrapper` (nullable WebSocket client), `ConnectionManager` (subscription lifecycle) and `ReactiveStore` (client side collection state)
- **Mini DDP protocol** ([`shared/protocol.ts`](shared/protocol.ts)): six message types, typed end to end

## What is planned, not yet built

- A server side method registry (RPC). The `method`, `result` and `error` message types already exist in the protocol; the registry that handles them is the next epic.
- File uploads and asset resolution as product features. The infrastructure wrappers exist; nothing user facing sits on them yet.

## Quick start

```bash
npm install

# Development (two terminals)
npm run dev:server   # Fastify on port 3001, auto restart
npm run dev:client   # Vite with HMR

# Checks
npm run typecheck
npm test
```

## Project structure

```
ekolite/
├── server/
│   ├── index.ts                  # createServer: Fastify + static + websocket
│   ├── start.ts                  # Entry point
│   ├── infrastructure/
│   │   ├── mongo.ts              # MongoWrapper, create() / createNull()
│   │   ├── websocket.ts          # WebSocketWrapper, create() / createNull()
│   │   ├── fileStorage.ts        # FileStorageWrapper
│   │   ├── scriptRunner.ts       # ScriptRunnerWrapper
│   │   └── outputTracker.ts      # EventEmitter + OutputTracker
│   └── logic/
│       └── publications.ts       # Pub/sub engine
├── client/
│   ├── clientSocket.ts           # ClientSocketWrapper, nullable WebSocket client
│   ├── connectionManager.ts      # Subscriptions and lifecycle
│   ├── reactiveStore.ts          # Client side collection state
│   └── main.ts                   # Browser entry point
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

Six message types, against roughly fifteen in full DDP:

```
Client → Server:
  { type: 'subscribe', id, name, params? }
  { type: 'unsubscribe', id }
  { type: 'method', id, name, params }      // handled by the upcoming method registry

Server → Client:
  { type: 'ready', id, collection }
  { type: 'added' | 'changed' | 'removed', collection, id, fields? }
  { type: 'result' | 'error', id, ... }
```

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
npm run build   # tsc + vite build
npm start       # node dist/server/index.js
```

## License

[MIT](LICENSE)
