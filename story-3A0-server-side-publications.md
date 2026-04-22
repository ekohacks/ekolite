# Story 3.A: Server-Side Publications

## What this story is about

Publications are how the server decides what data to send to which clients. A publication is a named function that returns a MongoDB query. When a client subscribes by name, the server runs the query, sends the results, and then keeps watching for changes so the client always has live data.

This is the server half of Smoke Test 3 (File List Updates in Real Time). The client half is Story 3.B (ReactiveStore) and Story 3.C (client subscribe function). But the server needs to exist first.

## Why it matters

Right now, a client can connect via WebSocket (Story 2.B) but there's nothing to connect _to_. The client opens a socket, the server accepts it, and then nothing happens. There's no way to ask for data.

Publications change that. After this story, a client can send `{ type: 'subscribe', name: 'files.all' }` and the server will:

1. Look up the publication by name
2. Query MongoDB for matching documents
3. Send each document to the client
4. Signal that the initial load is done
5. Keep watching and push any new documents as they appear
6. Stop watching when the client unsubscribes

That's the full lifecycle. Four developer stories, one behaviour each.

## What Meteor does today

```js
Meteor.publish('files.UserFiles.all', function () {
  return UserFiles.find().cursor;
});
```

One line. Meteor handles everything else: querying, sending, watching the oplog, cleaning up on disconnect. It's magic, which is great until you need to debug it.

We're building the same behaviour explicitly so you understand every piece.

## How the four developer stories fit together

```
3.A.1  Define + reject unknown
         │
         ▼
3.A.2  Handle known → send initial docs + ready
         │
         ▼
3.A.3  Watch for changes → push live updates
         │
         ▼
3.A.4  Unsubscribe → stop watching, clean up
```

Each story builds on the previous one. Do them in order.

| Story                                           | What it builds                              | What you'll learn                                                                       |
| ----------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| [3.A.1](story-3A1-register-publication.md)      | `define()` + error for unknown names        | Creating a logic class with Nulled infrastructure, the Publications constructor pattern |
| [3.A.2](story-3A2-send-initial-documents.md)    | Query Mongo, send `added` + `ready`         | Seeding the Null Mongo with `createNull({ find: [...] })`, message shaping              |
| [3.A.3](story-3A3-push-live-changes.md)         | Watch for Mongo changes, forward to clients | Change event watching, discovering infrastructure gaps, extending MongoWrapper          |
| [3.A.4](story-3A4-unsubscribe-stops-updates.md) | Stop watching on unsubscribe                | Cleanup patterns, memory leak prevention                                                |

## What already exists

| File                                      | What it does                          | Why it matters for this story                                                                         |
| ----------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `shared/protocol.ts`                      | The 6 message types                   | Publications sends `added`, `ready`, and `error` messages. Clients send `subscribe` and `unsubscribe` |
| `shared/types.ts`                         | `ChangeEvent` type                    | Change events from Mongo get mapped to protocol messages                                              |
| `server/infrastructure/mongo.ts`          | MongoDB wrapper with `createNull()`   | Publications uses `find()` and will need change watching                                              |
| `server/infrastructure/websocket.ts`      | WebSocket wrapper with `createNull()` | Publications uses `send()` to push messages to clients                                                |
| `server/infrastructure/output_tracker.ts` | EventEmitter + OutputTracker          | The Null Mongo emits change events through this system                                                |
| `client/clientSocket.ts`                  | Client WebSocket from Story 2.B       | This is what will eventually send subscribe messages, but you don't need it for server side tests     |

## Architecture: where Publications sits

```
┌─────────────────────────────────────────────────────┐
│  App Layer (Story 7.B)                              │
│  Wires infrastructure → logic, starts the server    │
├─────────────────────────────────────────────────────┤
│  Logic Layer  ◄── YOU ARE HERE                      │
│  ┌──────────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Publications  │  │ Methods  │  │ UploadHandler│  │
│  │ (Story 3.A)   │  │ (4.A)    │  │ (5.A/5.B)    │  │
│  └──────┬───────┘  └──────────┘  └──────────────┘  │
│         │                                           │
│         │ uses (injected via constructor)            │
├─────────┼───────────────────────────────────────────┤
│  Infrastructure Layer                               │
│  ┌──────▼───────┐  ┌───────────────┐                │
│  │ MongoWrapper  │  │ WebSocketWrapper│              │
│  │ create/Null   │  │ create/Null     │              │
│  └──────────────┘  └───────────────┘                │
└─────────────────────────────────────────────────────┘
```

Publications is a **logic class**. It never imports `mongodb` or `ws` directly. It receives `MongoWrapper` and `WebSocketWrapper` through its constructor. In tests, you pass Nulled versions. In production, you pass real ones. Same code, different infrastructure.

## The test file

All four developer stories add tests to the same file: `tests/logic/publications.test.ts`. By the end you'll have roughly 5 or 6 tests covering the full subscription lifecycle.

The tests are **sociable tests** (not unit tests). They exercise real Publications logic running with real (but in-memory) infrastructure. No mocks, no spies, no `vi.mock()`. Just `createNull()` and `client.messages`.

## The message flow

```
Client                    Publications                 MongoDB
  │                           │                           │
  │── subscribe ──────────►   │                           │
  │   { type: 'subscribe',    │── find(collection) ──►    │
  │     id: 'sub1',           │                           │
  │     name: 'files.all' }   │◄── [doc1, doc2] ─────────│
  │                           │                           │
  │◄── added { id: '1' } ────│                           │
  │◄── added { id: '2' } ────│                           │
  │◄── ready { id: 'sub1' } ─│                           │
  │                           │── watchChanges ──────►    │
  │                           │                           │
  │                           │      (time passes)        │
  │                           │                           │
  │                           │◄── insert event ─────────│
  │◄── added { id: '3' } ────│                           │
  │                           │                           │
  │── unsubscribe ────────►   │                           │
  │   { type: 'unsubscribe',  │── stop watching ─────►   │
  │     id: 'sub1' }          │                           │
  │                           │                           │
```

## Definition of done (whole story)

- [ ] `Publications` class exists at `server/logic/publications.ts`
- [ ] `define(name, queryFn)` registers publications
- [ ] `handleMessage(clientId, msg)` routes subscribe/unsubscribe
- [ ] Unknown publication sends error `{ code: 404 }`
- [ ] Known publication sends initial `added` messages + `ready`
- [ ] Live changes are pushed to subscribed clients
- [ ] Unsubscribe stops updates and cleans up watchers
- [ ] No memory leaks on repeated subscribe/unsubscribe
- [ ] All tests pass (`npm test`)
- [ ] No lint errors (`npm run lint`)

## What comes after

Once Story 3.A is done, the server can publish data. But there's no client to receive it yet.

| Next story                | What it builds                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| **3.B: ReactiveStore**    | Client side Map that handles `added`/`changed`/`removed` messages and emits change events         |
| **3.C: Client subscribe** | Wires the client WebSocket to send `subscribe` messages and feed responses into the ReactiveStore |

When all three (3.A + 3.B + 3.C) are done, Smoke Test 3 passes: insert a document in MongoDB and it appears in the browser without a refresh.
