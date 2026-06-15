# ekolite — Backlog

Start with [ekolite-overview.md](ekolite-overview.md) for the big picture. This backlog breaks down **Epic 4: Build EkoLite** into work a developer can pick up and start building.

---

## How This Backlog Works

### Hierarchy

```
Epic 4: Build ekolite
  └── Smoke Test (proves a Meteor capability is replaced)
       └── Story (a meaningful chunk of work, 1-3 days)
            └── Developer Story (TDD-sized, 1-3 red-green-refactor cycles)
                 └── Sub-story (one red-green-refactor cycle, 5-20 min)
```

Each Developer Story has **3 sub-stories** following the TDD cycle:

- **Sub-story a = Red** — write a failing test
- **Sub-story b = Green** — write the minimum code to pass
- **Sub-story c = Refactor** — improve structure, tests stay green

Do them in order: a → b → c → next developer story. See `ekolite-tdd-training.md` Section 6 for a detailed explanation of how to read and execute these.

### The 7 Smoke Tests

Each smoke test is a checkpoint. When it passes, a piece of the framework is proven. When **all 7 pass**, the framework is ready and we migrate the real app (Phase 2).

See `ekolite-epics.md` → Epic 4 for the full smoke test table.

---

## Smoke Test 0: Infrastructure Wrappers

> **What it proves:** We can test all our code without connecting to real databases, file systems, or WebSockets.
>
> **Pass criteria:** All parity tests green — the Null version behaves identically to the Real version.
>
> **Why this is first:** Every other smoke test depends on these wrappers. Without them, we can't write fast tests for the logic layer.

---

### Story 0.A: MongoDB Wrapper

> Wrap the `mongodb` driver so the rest of our code never imports `mongodb` directly.
>
> **What Meteor does today:** `FilesCollection` in `imports/api/files.js` wraps MongoDB with file storage. Minimongo mirrors data to the client.
> **What we're building:** `MongoWrapper` — thin wrapper with `create()` (real MongoDB) and `createNull()` (in-memory, same interface).

#### Developer Story 0.A.1: Insert and find documents

> **File to create:** `server/infrastructure/mongo.ts`
> **Test file to create:** `tests/infrastructure/mongo.test.ts`

**Sub-story a — Red:**

```ts
// tests/infrastructure/mongo.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { MongoWrapper } from '../../server/infrastructure/mongo';

describe('MongoWrapper (real)', () => {
  const mongo = MongoWrapper.create('mongodb://localhost:27017/ekolite-test');

  afterEach(async () => {
    await mongo.remove('testDocs', {});
  });

  it('inserts and finds documents', async () => {
    await mongo.insert('testDocs', { name: 'test.bam' });
    const docs = await mongo.find('testDocs', {});
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('test.bam');
  });
});
```

Run `npx vitest run tests/infrastructure/mongo.test.ts`. It fails — `MongoWrapper` doesn't exist. That's Red.

**Sub-story b — Green:**
Create `server/infrastructure/mongo.ts`. Implement `MongoWrapper` class with `create()` using the real `mongodb` driver. Implement `insert()` and `find()`. Minimum code to pass.

**Sub-story c — Refactor:**
Now write the Null version in the same file:

```ts
static createNull(docs: Record<string, unknown[]> = {}): MongoWrapper {
  return new MongoWrapper(new StubbedMongoClient(docs));
}
```

Write a **parity test** that runs the same assertions against both:

```ts
// tests/infrastructure/mongo.parity.ts
function mongoTests(createMongo: () => MongoWrapper) {
  it('inserts and finds documents', async () => {
    const mongo = createMongo();
    await mongo.insert('files', { name: 'a.bam' });
    const docs = await mongo.find('files', {});
    expect(docs).toHaveLength(1);
  });
}

describe('MongoWrapper (real)', () => mongoTests(() => MongoWrapper.create(uri)));
describe('MongoWrapper (null)', () => mongoTests(() => MongoWrapper.createNull()));
```

**Done when:** Both `describe` blocks pass with identical assertions.

---

#### Developer Story 0.A.2: Change stream events

> **Why:** Pub/sub (Smoke Test 3) needs to detect when documents change in real time. Meteor uses oplog tailing. We use MongoDB change streams.

**Sub-story a — Red:**
Add to the parity test:

```ts
it('fires change listener on insert', async () => {
  const mongo = createMongo();
  const changes: ChangeEvent[] = [];
  mongo.watchChanges('files', (event) => changes.push(event));

  await mongo.insert('files', { name: 'new.bam' });

  await eventually(() => {
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('insert');
  });
});
```

Fails — `watchChanges` doesn't exist. Red.

**Sub-story b — Green:**
Implement `watchChanges()` — real version uses MongoDB change streams, Null version dispatches events from the in-memory store on insert/update/remove.

**Sub-story c — Refactor:**
Define and export the `ChangeEvent` type in `shared/types.ts`.

**Done when:** Parity test passes for both real and Null.

---

#### Developer Story 0.A.3: Update and remove

**Sub-story a — Red:**
Parity tests: insert → update a field → find → assert field changed. Insert → remove → find → assert empty. Also test that change listeners fire for update and remove.

**Sub-story b — Green:**
Implement `update()` and `remove()` on both the real client and the stubbed client.

**Sub-story c — Refactor:**
Ensure change listeners fire the correct event type (`'update'`, `'remove'`).

**Done when:** Parity tests pass for all CRUD operations with change events.

---

### Story 0.B: WebSocket Server Wrapper

> Wrap `@fastify/websocket` so the logic layer never imports WebSocket code directly.
>
> **What Meteor does today:** DDP transport — invisible, Meteor manages it.
> **What we're building:** `WebSocketServer` with `create()` (real Fastify WebSocket) and `createNull()` (in-memory connections).

#### Developer Story 0.B.1: Connection handling

> **File to create:** `server/infrastructure/websocket.ts`
> **Test file to create:** `tests/infrastructure/websocket.test.ts`

**Sub-story a — Red:**
Narrow integration test: start Fastify with `@fastify/websocket`, connect a WS client, assert `onConnection` callback fires and a sent message arrives.

**Sub-story b — Green:**
Implement `WebSocketServer.create(fastify)`. Implement `createNull()` with in-memory connection tracking.

**Sub-story c — Refactor:**
Add `simulateConnection()` and `simulateMessage()` to the Null — these let logic tests simulate clients without a real WebSocket. Write parity tests.

**Done when:** Parity test passes: connect → send → receive works on both real and Null.

---

#### Developer Story 0.B.2: Output tracking

> **Why:** Traditional testing uses `vi.spyOn(ws, 'send')`. We use Output Tracking instead — `trackMessages()` records what was sent, queryable by client ID.

**Sub-story a — Red:**
Test: send messages to two different clients, assert `tracker.messagesTo(clientA)` and `tracker.messagesTo(clientB)` return the correct messages.

**Sub-story b — Green:**
Implement `MessageTracker` that records every `send()` call.

**Sub-story c — Refactor:**
Add `broadcast()` method. Verify tracker captures broadcast messages too.

**Done when:** `trackMessages() → send() → messagesTo(id)` returns correct messages.

---

### Story 0.C: File Storage Wrapper

> Wrap Node.js `fs` so file operations can run in-memory during tests.
>
> **What Meteor does today:** `ostrio:files` stores files at `storagePath: 'assets/app/uploads'`. Uses `fs.rename()` in `onAfterUpload`.
> **What we're building:** `FileStorage` with `create(basePath)` (real disk) and `createNull()` (in-memory `Map<string, Buffer>`).

#### Developer Story 0.C.1: Save, exists, remove, resolve

> **File to create:** `server/infrastructure/fileStorage.ts`
> **Test file to create:** `tests/infrastructure/fileStorage.test.ts`

**Sub-story a — Red:**
Parity test: `save('test.bam', buffer)` → `exists('test.bam')` returns true. `remove('test.bam')` → `exists('test.bam')` returns false. `resolve('test.bam')` returns an absolute path.

**Sub-story b — Green:**
Real version uses `fs.writeFile`, `fs.access`, `fs.unlink`, `path.resolve`. Null version uses `Map<string, Buffer>`.

**Sub-story c — Refactor:**
Clean up the parity test. Ensure both versions throw on save failure (e.g., empty name).

**Done when:** Parity tests pass for save, exists, remove, resolve.

---

### Story 0.D: Script Runner Wrapper

> Wrap `child_process.execFile` so Python script execution can be faked in tests.
>
> **What Meteor does today:** `execFile("python3", [scriptPath, targetAbs], callback)` in `imports/api/PythonMethods.js`.
> **What we're building:** `ScriptRunner` with `create()` (real child_process) and `createNull({ python3: 'count: 42' })` (returns configured responses).

#### Developer Story 0.D.1: Execute and return result

> **File to create:** `server/infrastructure/scriptRunner.ts`
> **Test file to create:** `tests/infrastructure/scriptRunner.test.ts`

**Sub-story a — Red:**
Narrow integration test: `exec('echo', ['hello'])` returns `{ stdout: 'hello\n', stderr: '', exitCode: 0 }`.

**Sub-story b — Green:**
Real version wraps `child_process.execFile` in a Promise. Null version looks up the command in a response map.

**Sub-story c — Refactor:**
Define `ScriptResult` type in `shared/types.ts`. Write parity test (real `echo` command vs Null with configured `'hello\n'`).

**Done when:** Parity tests pass.

---

### Smoke Test 0 Complete

At this point you have:

- 4 infrastructure wrappers, each with `create()` and `createNull()`
- Parity tests proving Null matches Real
- No logic code yet — that's next
- **All fast tests run in <1 second** (Nulled)
- **All narrow integration tests pass** (real MongoDB, real fs, real processes)

---

## Smoke Test 1: Server Starts and Serves a Page

> **What it proves:** Fastify + Vite replace Meteor's build system and server.
>
> **Pass criteria:** Browser loads an HTML page from Fastify. No console errors. Vite dev server proxies to Fastify.

---

### Story 1.A: Fastify serves a static page

> **What Meteor does today:** `Meteor.startup()` in `client/main.jsx` renders React after the framework boots. Meteor's build system bundles everything.
> **What we're building:** Fastify serves `dist/client/index.html` via `@fastify/static`.

#### Developer Story 1.A.1: Fastify returns index.html

**Sub-story a — Red:**
Narrow integration test: start Fastify with `@fastify/static`, `GET /` returns HTTP 200 with `text/html`.

**Sub-story b — Green:**
Register `@fastify/static` pointing at a `dist/client` directory. Create a minimal `index.html`.

**Sub-story c — Refactor:**
Extract server bootstrap into a `createServer(config)` factory. Define `ServerConfig` type.

**Done when:** `GET / → 200, text/html`

---

### Story 1.B: Vite development configuration

> **What Meteor does today:** Meteor's custom bundler + Babel + hot code push (full page reload).
> **What we're building:** Vite config with HMR (<100ms) and proxy to Fastify.

#### Developer Story 1.B.1: Vite config with proxy rules

**Red:** `vite` command fails because no config exists.

**Green:** Create `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
```

**Refactor:** N/A.

**Done when:** `vite` starts, `GET /` serves the page, `/api` and `/ws` proxy to Fastify.

---

## Smoke Test 2: Real-Time Connection

> **What it proves:** WebSocket replaces DDP transport.
>
> **Pass criteria:** Browser connects via WebSocket. Connection stays open. Server knows about the client.

---

### Story 2.A: WebSocket endpoint on Fastify

> **What Meteor does today:** DDP auto-connects when the page loads. Invisible.
> **What we're building:** Explicit WebSocket route on Fastify, using the wrapper from Story 0.B.

#### Developer Story 2.A.1: WebSocket route accepts connections

**Sub-story a — Red:** Narrow integration test: start Fastify with WS plugin, connect a client, assert connection opens.

**Sub-story b — Green:** Register `@fastify/websocket` route on the Fastify instance from Story 1.A.

**Sub-story c — Refactor:** Extract into a Fastify plugin (`server/plugins/websocket.ts`).

**Done when:** `ws://localhost:3001/ws` connects without error.

#### Developer Story 2.A.2: Track connected clients

**Sub-story a — Red:** Sociable test with Null: `simulateConnection()`, assert `getClientCount() === 1`.

**Sub-story b — Green:** `onConnection` handler adds clients to `Map<string, Connection>`.

**Sub-story c — Refactor:** Add client ID generation (UUID or counter).

**Done when:** Server tracks connected clients.

---

### Story 2.B: Client connects on page load

> **What Meteor does today:** `Meteor.startup()` opens DDP connection automatically.
> **What we're building:** A connection manager that opens a WebSocket and tracks status.

#### Developer Story 2.B.1: Connection manager

**Sub-story a — Red:** Client test: create connection, assert status becomes `'connected'` after open.

**Sub-story b — Green:** Implement connection manager — opens WebSocket, tracks status, emits events.

**Sub-story c — Refactor:** Add simple reconnect-on-close with backoff.

**Done when:** `new Connection(url) → on('open') → status === 'connected'`

---

## Smoke Test 3: File List Updates in Real Time

> **What it proves:** Publications + ReactiveStore replace Meteor.publish + Meteor.subscribe + Minimongo + useTracker.
>
> **Pass criteria:** Insert a document in MongoDB → it appears in the browser without refresh.

---

### Story 3.A: Server-side publications

> **What Meteor does today:**
>
> ```js
> Meteor.publish('files.UserFiles.all', function () {
>   return UserFiles.find().cursor;
> });
> ```
>
> **What we're building:** `Publications` class — defines publications, handles subscriptions, pushes initial data + live changes via WebSocket.

#### Developer Story 3.A.1: Register a publication

**Sub-story a — Red:** Sociable test: define a publication, subscribe to an unknown name, assert error sent via `trackMessages()`.

**Sub-story b — Green:** `define()` stores in `Map<string, PublicationDef>`. Unknown name sends error.

**Sub-story c — Refactor:** Extract `PublicationDef` type.

**Done when:** Unknown publication → error message sent.

#### Developer Story 3.A.2: Send initial documents on subscribe

**Sub-story a — Red:** Sociable test: seed Null Mongo with `[{ _id: '1', name: 'existing.bam' }]`, subscribe, assert `trackMessages()` has `'added'` + `'ready'`.

**Sub-story b — Green:** `handleSubscribe` queries Mongo, sends each doc as `'added'`, sends `'ready'`.

**Sub-story c — Refactor:** Extract `toAddedMsg()`, `toReadyMsg()` helpers.

**Done when:** Subscribe → receive initial docs + ready signal.

#### Developer Story 3.A.3: Push live changes

**Sub-story a — Red:** Sociable test: subscribe, then `mongo.insert(...)`, assert new `'added'` in `trackMessages()`.

**Sub-story b — Green:** Wire `mongo.watchChanges()` to send data messages to subscribed clients.

**Sub-story c — Refactor:** Extract change-event-to-message mapping.

**Done when:** Insert after subscribe → client gets `'added'` message.

#### Developer Story 3.A.4: Unsubscribe stops updates

**Sub-story a — Red:** Subscribe, unsubscribe, insert → no new messages.

**Sub-story b — Green:** Remove client from tracking. Clean up change stream listener.

**Sub-story c — Refactor:** Verify no memory leaks.

**Done when:** Unsubscribe → no more messages.

---

### Story 3.B: Client-side reactive store

> **What Meteor does today:** Minimongo + `useTracker(() => UserFiles.find({}))` in `Home.jsx`.
> **What we're building:** `ReactiveStore` — a `Map` that responds to `added`/`changed`/`removed` messages and emits `'change'` events.

#### Developer Story 3.B.1: Handle 'added' messages

**Sub-story a — Red:** Client test: `handleMessage({ type: 'added', id: '1', fields: { name: 'a.bam' } })` → `getAll()` returns the doc.

**Sub-story b — Green:** `ReactiveStore` with `Map<string, T>`. `handleMessage('added')` inserts.

**Sub-story c — Refactor:** Add `getById()`.

**Done when:** `added` → doc in store.

#### Developer Story 3.B.2: Emit change events

**Sub-story a — Red:** Register `'change'` listener, handle an `'added'` message, assert listener called.

**Sub-story b — Green:** Emit `'change'` after every `handleMessage`.

**Sub-story c — Refactor:** Add `off()` for cleanup.

**Done when:** Store emits changes.

#### Developer Story 3.B.3: Handle 'changed' and 'removed'

**Sub-story a — Red:** `'changed'` updates fields. `'removed'` deletes doc.

**Sub-story b — Green:** Add branches to `handleMessage`.

**Sub-story c — Refactor:** Consolidate if duplicated.

**Done when:** All three message types work.

---

### Story 3.C: Client subscribe function

> Wire the connection manager to send subscribe messages and feed responses into the store.

#### Developer Story 3.C.1: Subscribe sends message and routes responses

**Sub-story a — Red:** `subscribe('files.all')` sends a `{ type: 'subscribe' }` message. Simulate receiving `'added'` + `'ready'`. Assert store has data, subscription is ready.

**Sub-story b — Green:** `subscribe()` sends the message, listens for matching responses, feeds to `ReactiveStore`.

**Sub-story c — Refactor:** Return handle with `.stop()` and `.ready`.

**Done when:** Full client subscribe flow works.

---

## Smoke Test 4: Run Server Method from Browser

> **What it proves:** Methods + RpcHandler replace Meteor.methods + Meteor.call.
>
> **Pass criteria:** Client calls a method → server executes → client gets the result.

---

### Story 4.A: Server-side method registry

> **What Meteor does today:**
>
> ```js
> Meteor.methods({ async runCountC() { ... } });
> ```
>
> **What we're building:** `Methods` class — `define()` and `call()`. This is the worked example in the TDD training.

#### Developer Story 4.A.1: Define and call a method

_(See `ekolite-tdd-training.md` Section 4: Worked Example for the full code walkthrough.)_

**Sub-story a — Red:** Define `'echo'`, call with `['hello']`, expect `'echo: hello'`.
**Sub-story b — Green:** Map-based registry.
**Sub-story c — Refactor:** Export `MethodFn` type.

#### Developer Story 4.A.2: Structured error for unknown methods

**Sub-story a — Red:** Call `'nope'` → expect `{ code: 404 }`.
**Sub-story b — Green:** Guard clause.
**Sub-story c — Refactor:** Extract error factory.

---

### Story 4.B: RPC over WebSocket

> Route `{ type: 'method' }` WebSocket messages to the method registry.

#### Developer Story 4.B.1: Route method call and return result

**Sub-story a — Red:** `simulateMessage({ type: 'method', name: 'echo', params: ['test'] })` → `trackMessages()` has `{ type: 'result' }`.

**Sub-story b — Green:** `RpcHandler` listens for method messages, calls `Methods.call()`, sends result.

**Sub-story c — Refactor:** Extract message routing.

#### Developer Story 4.B.2: Return error for failed methods

**Sub-story a — Red:** Bad method → `trackMessages()` has `{ type: 'error' }`.
**Sub-story b — Green:** Try/catch, send error.
**Sub-story c — Refactor:** Normalize to `MeteorLightError`.

---

### Story 4.C: Client-side method caller

> **What Meteor does today:** `Meteor.callAsync('runCountC', targetPath)` in `GoSubmitButton.jsx`.
> **What we're building:** `MeteorLight.call()` — sends method message, returns Promise.

#### Developer Story 4.C.1: Call sends message and resolves promise

**Sub-story a — Red:** `call('echo', 'hello')` → simulate `{ type: 'result' }` → Promise resolves.
**Sub-story b — Green:** Generate unique ID, send `{ type: 'method' }`, return Promise.
**Sub-story c — Refactor:** Extract ID generation. Add rejection on `'error'`.

---

## Smoke Test 5: Upload a BAM File

> **What it proves:** @fastify/multipart + UploadHandler replace ostrio:files.
>
> **Pass criteria:** Upload .bam → progress shown → file on disk → metadata in DB → appears in real-time list.

---

### Story 5.A: Server-side upload validation

> **What Meteor does today:**
>
> ```js
> onBeforeUpload(file) {
>   if (/bam$/i.test(file.extension)) return true;
>   return 'Only .bam files are allowed!';
> }
> ```
>
> **What we're building:** `UploadHandler.validate()`.

#### Developer Story 5.A.1: Accept .bam files

**Sub-story a — Red:** `validate({ name: 'sample.bam' })` returns true.
**Sub-story b — Green:** Check extension.
**Sub-story c — Refactor:** Make `allowedExtensions` configurable.

#### Developer Story 5.A.2: Reject non-.bam files

**Sub-story a — Red:** `handle({ name: 'bad.txt' })` rejects `{ code: 400 }`. File not stored.
**Sub-story b — Green:** Guard before save.
**Sub-story c — Refactor:** Unify error shape with `MeteorLightError`.

---

### Story 5.B: Server-side file storage and metadata

> **What Meteor does today:** `ostrio:files` stores file on disk, inserts metadata, runs `onAfterUpload` to rename.
> **What we're building:** `UploadHandler.handle()` → `FileStorage.save()` + `MongoWrapper.insert()`.

#### Developer Story 5.B.1: Store file and insert metadata

**Sub-story a — Red:** `handle({ name: 'sample.bam', data: Buffer, size: 11 })` → `files.exists('sample.bam')` true + `mongo.find('UserFiles', {})` has 1 doc.
**Sub-story b — Green:** `fileStorage.save()` then `mongo.insert()`.
**Sub-story c — Refactor:** Extract `StoredFile` construction.

#### Developer Story 5.B.2: Upload triggers real-time list update

**Sub-story a — Red:** Subscribe to `'UserFiles.all'`, upload → `trackMessages()` has `'added'`.
**Sub-story b — Green:** Should work if change streams are wired. This test reveals gaps.
**Sub-story c — Refactor:** Verify wiring.

---

### Story 5.C: HTTP upload endpoint

> **What we're building:** `POST /api/upload` using `@fastify/multipart`.

#### Developer Story 5.C.1: POST /api/upload route

**Sub-story a — Red:** Multipart POST with .bam → HTTP 200 + file metadata.
**Sub-story b — Green:** Register `@fastify/multipart`, wire to `UploadHandler`.
**Sub-story c — Refactor:** Extract into Fastify plugin.

#### Developer Story 5.C.2: Route returns 400 for invalid files

**Sub-story a — Red:** POST .txt → HTTP 400.
**Sub-story b — Green:** Catch validation error, return 400.
**Sub-story c — Refactor:** Consistent error format.

---

### Story 5.D: Client-side upload with progress

> **What Meteor does today:**
>
> ```jsx
> BamCollection.insert({ file, onProgress(pct) { setProgress(pct) }, onUploaded(...) { ... } })
> ```
>
> **What we're building:** `MeteorLight.upload()` with `'progress'`, `'complete'`, `'error'` events.

#### Developer Story 5.D.1: Upload with progress events

**Sub-story a — Red:** Start upload → `'progress'` event fires.
**Sub-story b — Green:** `XMLHttpRequest` with progress tracking.
**Sub-story c — Refactor:** Normalize `{ percent: number }`.

#### Developer Story 5.D.2: Complete and error events

**Sub-story a — Red:** .bam → `'complete'` with StoredFile. .txt → `'error'` with message.
**Sub-story b — Green:** Parse response, emit events.
**Sub-story c — Refactor:** Share error parsing with `call()` if similar.

---

## Smoke Test 6: Reject Invalid Files

> **What it proves:** Validation works end-to-end (server + HTTP + client).
>
> **Pass criteria:** Upload .txt → 400 error → no file stored → client shows error.

**No additional stories.** This smoke test passes when Stories 5.A.2, 5.C.2, and 5.D.2 are complete.

---

## Smoke Test 7: End-to-End Pipeline (THE GATE)

> **What it proves:** The full app workflow works on ekolite.
>
> **Pass criteria:** Upload .bam → subscribe sees it → call runCountC → get result.
>
> **When this passes, the framework is proven. Phase 2 migration begins.**

---

### Story 7.A: Wire the analysis method

> **What Meteor does today:**
>
> ```js
> const scriptPath = Assets.absoluteFilePath('scripts/countC.py');
> execFile('python3', [scriptPath, targetAbs], callback);
> ```
>
> **What we're building:** `runCountC` defined via `Methods.define()` using `ScriptRunner` and `resolveAsset()`.

#### Developer Story 7.A.1: Define runCountC with ScriptRunner

**Sub-story a — Red:** Define `'runCountC'` with `ScriptRunner.createNull({ python3: 'count: 42' })`, call it, expect `'count: 42'`.
**Sub-story b — Green:** `resolveAsset()` → `scripts.exec()` → return stdout.
**Sub-story c — Refactor:** Extract script path into config.

---

### Story 7.B: Application wiring

> Wire all subsystems into the `App` class. This is the A-Frame application layer.

#### Developer Story 7.B.1: App.createNull assembles all parts

**Sub-story a — Red:** `App.createNull()` returns object with `publications`, `methods`, `uploads`, `ws`.
**Sub-story b — Green:** Constructor wires everything. `createNull()` injects all Nulled wrappers.
**Sub-story c — Refactor:** Add config interface.

#### Developer Story 7.B.2: Full pipeline integration test

**Sub-story a — Red:** The big one:

1. `App.createNull({ scriptResponses: { python3: 'count: 7' } })`
2. Client connects, subscribes to `'UserFiles.all'`
3. Upload `.bam` file
4. Assert `'added'` message for the file
5. Call `'runCountC'`
6. Assert `{ type: 'result', result: 'count: 7' }`

**Sub-story b — Green:** Should pass if everything is wired. If not, reveals the gap.
**Sub-story c — Refactor:** Final cleanup.

**Done when:** `connect → subscribe → upload → see file → analyze → get result`. **This is the gate.**

#### Developer Story 7.B.3: App.create with real infrastructure

**Sub-story a — Red:** `App.create(config)` starts Fastify, connects MongoDB, serves static files.
**Sub-story b — Green:** Wire all `.create()` factories.
**Sub-story c — Refactor:** Add graceful shutdown.

---

## Appendix: Hierarchy at a Glance

```
Epic 4: Build ekolite
│
├── Smoke Test 0: Infrastructure Wrappers
│   ├── Story 0.A: MongoDB Wrapper
│   │   ├── 0.A.1: Insert and find
│   │   ├── 0.A.2: Change streams
│   │   └── 0.A.3: Update and remove
│   ├── Story 0.B: WebSocket Server Wrapper
│   │   ├── 0.B.1: Connection handling
│   │   └── 0.B.2: Output tracking
│   ├── Story 0.C: File Storage Wrapper
│   │   └── 0.C.1: Save, exists, remove, resolve
│   └── Story 0.D: Script Runner Wrapper
│       └── 0.D.1: Execute and return result
│
├── Smoke Test 1: Server Starts and Serves a Page
│   ├── Story 1.A: Fastify serves a static page
│   │   └── 1.A.1: Fastify returns index.html
│   └── Story 1.B: Vite development configuration
│       └── 1.B.1: Vite config with proxy
│
├── Smoke Test 2: Real-Time Connection
│   ├── Story 2.A: WebSocket endpoint on Fastify
│   │   ├── 2.A.1: WS route accepts connections
│   │   └── 2.A.2: Track connected clients
│   └── Story 2.B: Client connects on page load
│       └── 2.B.1: Connection manager
│
├── Smoke Test 3: File List Updates in Real Time
│   ├── Story 3.A: Server-side publications
│   │   ├── 3.A.1: Register a publication
│   │   ├── 3.A.2: Send initial docs on subscribe
│   │   ├── 3.A.3: Push live changes
│   │   └── 3.A.4: Unsubscribe stops updates
│   ├── Story 3.B: Client-side reactive store
│   │   ├── 3.B.1: Handle 'added'
│   │   ├── 3.B.2: Emit change events
│   │   └── 3.B.3: Handle 'changed' and 'removed'
│   └── Story 3.C: Client subscribe function
│       └── 3.C.1: Subscribe and route responses
│
├── Smoke Test 4: Run Server Method from Browser
│   ├── Story 4.A: Server-side method registry
│   │   ├── 4.A.1: Define and call
│   │   └── 4.A.2: Structured error
│   ├── Story 4.B: RPC over WebSocket
│   │   ├── 4.B.1: Route method call
│   │   └── 4.B.2: Return error
│   └── Story 4.C: Client-side method caller
│       └── 4.C.1: Call and resolve
│
├── Smoke Test 5: Upload a BAM File
│   ├── Story 5.A: Server-side validation
│   │   ├── 5.A.1: Accept .bam
│   │   └── 5.A.2: Reject non-.bam
│   ├── Story 5.B: File storage and metadata
│   │   ├── 5.B.1: Store file + metadata
│   │   └── 5.B.2: Triggers pub/sub
│   ├── Story 5.C: HTTP upload endpoint
│   │   ├── 5.C.1: POST /api/upload
│   │   └── 5.C.2: 400 for invalid
│   └── Story 5.D: Client-side upload
│       ├── 5.D.1: Progress events
│       └── 5.D.2: Complete and error
│
├── Smoke Test 6: Reject Invalid Files
│   └── (Covered by 5.A.2, 5.C.2, 5.D.2)
│
└── Smoke Test 7: End-to-End Pipeline ← THE GATE
    ├── Story 7.A: Wire analysis method
    │   └── 7.A.1: Define runCountC
    └── Story 7.B: Application wiring
        ├── 7.B.1: App.createNull
        ├── 7.B.2: Full pipeline test
        └── 7.B.3: App.create with real infra
```
