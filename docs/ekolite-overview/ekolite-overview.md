# EkoLite — Overview

A small real-time backend framework, around 3,500 lines of TypeScript across server, client and shared. Tested without mocks.

---

## What It Does

EkoLite is a lightweight real-time backend framework. Five standard tools do the whole job:

| Capability     | How                                             |
| -------------- | ----------------------------------------------- |
| HTTP server    | Fastify                                         |
| Real-time data | WebSocket + Mini-DDP (11 message types)         |
| Database       | MongoDB driver + change streams                 |
| Client data    | ReactiveStore (a simple Map that stays in sync) |
| File uploads   | @fastify/multipart                              |
| Build          | Vite (client) + tsx (server)                    |

---

## Architecture

Three layers. Logic never touches external systems directly.

```
              App (wires everything)
           /         |          \
  Publications    Methods      Files             ← Logic
           \         |          /
  MongoWrapper  WebSocketWrapper  FileStorageWrapper   ← Infrastructure
           |         |          |
       MongoDB    Fastify    Node fs              ← External systems
```

Every infrastructure wrapper has two factories:

- `create()` — connects to the real system
- `createNull()` — runs in-memory, same interface

This is how we test without mocks. The logic layer doesn't know which one it's talking to.

---

## The Protocol

Client and server talk over WebSocket with 11 message types:

```
Client → Server:         Server → Client:
  subscribe                ready
  unsubscribe              added / changed / removed
  method                   result / error
  ping                     pong
```

Full DDP has ~15 message types. The saving is less in the count than in what is absent: no connect handshake, no session identity, no merge box, no latency compensation.

---

## How We Build It

**Red-Green-Refactor**, every time:

1. **Red** — Write a failing test using `createNull()` infrastructure
2. **Green** — Write the minimum code to make it pass
3. **Refactor** — Improve structure, tests stay green

No `vi.mock()`. No spies. Real code with an off switch.

---

## Where It Stands

EkoLite is published early at `0.x` and the public API is still settling. What is built:

- **Pub/sub over a live socket.** Define a publication, subscribe from a page, and a reactive store fills from MongoDB change streams and keeps up as the data moves.
- **RPC methods.** Register a named server method, call it over the socket, get a typed result or a structured error back.
- **File uploads over HTTP.** The bytes go to storage, the metadata goes to MongoDB, and the change stream pushes the new file into every subscribed client's list.
- **Nullable infrastructure.** Every wrapper has `create()` and `createNull()`, so the whole graph runs in memory for tests.
- **App wiring.** `App.create()` assembles the real graph and `App.createNull()` assembles the same one nulled, so the tests drive the assembly that boots in production.
- **Graceful shutdown.** On a stop signal the server stops taking requests, drains the change streams, closes MongoDB and exits.
- **A heartbeat**, so a client can tell a silently dead socket from a quiet one.

What is not built yet, and matters:

- **Reconnect and resubscribe.** A closed socket disposes and stays disposed. The client does not yet come back on its own.
- **Auth on the file routes.** `POST /api/files` and `GET /api/files/:id` are open.

---

## Deep Dive Docs

Read these when you need detail on a specific topic:

| Doc                                                | What's in it                                              |
| -------------------------------------------------- | --------------------------------------------------------- |
| [System design](ekolite-system-design.md)          | How the framework is put together, and why                |
| [Architecture decisions](ekolite-adrs.md)          | What was decided, and what it cost                        |
| [Test-driven development](ekolite-tdd-training.md) | The red, green, refactor loop with worked examples        |
| [TDD engineering guide](ekolite-tdd.md)            | The wrappers, their signatures, and contract tests        |
| [API reference](../api/connection-manager.md)      | The client surface: ConnectionManager, SubscriptionHandle |
