# EkoLite, TDD Engineering Guide

This is the reference for how EkoLite is tested: the nullable pattern, the wrappers, the layers and the shape of the suite. [Test-driven development](ekolite-tdd-training.md) is the tour with worked examples; start there if you want the loop rather than the catalogue. [ekolite-overview.md](ekolite-overview.md) is the big picture.

The pattern comes from James Shore's [Testing Without Mocks](https://www.jamesshore.com/v2/projects/nullables/testing-without-mocks).

---

## Core Principles

1. **No mocks.** Not for MongoDB, not for the WebSocket, not for the file system. There is no mocking library in the project.
2. **Nullables.** Every infrastructure wrapper has `create()` and `createNull()`. The nulled one behaves the same and touches nothing outside the process.
3. **Sociable tests.** Real dependency chains. `Publications` is tested as the real `Publications`, holding a nulled `MongoWrapper`.
4. **State-based assertions.** Assert what came out, not which functions were called on the way.
5. **A-Frame architecture.** Logic and infrastructure are peers, and the application layer wires them together.

---

## A-Frame Architecture

```
              Application layer
                (server/app.ts)
              /       |        \
             v        v         v
          Logic     Logic     Logic
      (publications) (methods) (files)
             \        |        /
              v       v       v
           Infrastructure wrappers
      Mongo   WebSocket   FileStorage   ScriptRunner
```

Logic never imports infrastructure. It receives wrappers through the constructor, so it cannot tell a real one from a nulled one, and the application layer decides which it gets.

---

## Infrastructure Wrappers

Each wrapper owns one external system, and each has an embedded stub in the same file.

### MongoWrapper

`server/infrastructure/mongo.ts`, over the `mongodb` driver.

```ts
static create(uri: string): MongoWrapper;
static createNull(options?: StubbedMongoOptions): MongoWrapper;

async find<T>(collection: string, query: object): Promise<T[]>;
async insert(collection: string, doc: object): Promise<void>;
async update(collection: string, query: object, changes: object): Promise<void>;
async remove(collection: string, query: object): Promise<void>;
async close(): Promise<void>;

watcherCount(collection: string): number;
async trackChanges(collection: string): Promise<OutputTracker>;
trackClose(): OutputTracker;
```

The nulled Mongo is configured with responses, not with a seeded database. Each key takes a list, and each entry is the answer to the next call:

```ts
const mongo = MongoWrapper.createNull({
  find: [[{ _id: '1', name: 'existing.bam' }]],
});
```

Pass an `Error` instead of a value to make the next call fail, which is how failure paths are tested without breaking a real database to get there.

### WebSocketWrapper

`server/infrastructure/websocket.ts`, over `@fastify/websocket`.

```ts
static create(): WebSocketWrapper;
static createRawWs(options: { port: number }): WebSocketWrapper;
static createNull(options?: { close?: unknown[] }): WebSocketWrapper;

async attach(fastify: FastifyInstance): Promise<void>;
send(clientId: string, message: unknown): void;
broadcast(message: unknown): void;
onMessage(cb: (clientId: string, message: unknown) => void): void;

simulateConnection(): StubbedClient; // null instance only
trackMessages(): OutputTracker;
trackConnections(): OutputTracker;
trackDisconnections(): OutputTracker;
```

`create()` takes no Fastify instance. It is attached separately with `attach(fastify)`, which is what lets the wrapper be constructed before the server exists.

`simulateConnection()` returns a `StubbedClient` that records everything sent to it. That recording is how the tests see the output:

```ts
const ws = WebSocketWrapper.createNull();
const client = ws.simulateConnection();

client.send({ type: 'subscribe', id: 'sub1', name: 'files.all' });

expect(client.messages).toContainEqual({ type: 'ready', id: 'sub1', collection: 'files' });
```

### FileStorageWrapper

`server/infrastructure/fileStorage.ts`, over `node:fs`.

```ts
static create(basePath: string): FileStorageWrapper;
static createNull(options?: StubbedFileSystemOptions): FileStorageWrapper;

async save(name: string, data: Buffer): Promise<void>;
async read(name: string): Promise<Buffer>;
async exists(name: string): Promise<boolean>;
async remove(name: string): Promise<void>;
resolve(name: string): string;
trackChanges(): OutputTracker;
```

### ScriptRunnerWrapper

`server/infrastructure/scriptRunner.ts`, over `child_process`.

```ts
static create(): ScriptRunnerWrapper;
static createNull(responses?: ScriptRunnerResponses): ScriptRunnerWrapper;

async exec(command: string, args: string[]): Promise<ScriptResult>;
trackChanges(): OutputTracker;
```

The nulled runner is keyed by command, so a test can say what `python3` returns without a Python interpreter anywhere near it.

---

## Logic Layer

Logic classes take their infrastructure through the constructor and know nothing about where it came from.

```ts
new Publications(mongo, ws); // pub/sub over change streams
new Methods(); // the method registry, no infrastructure at all
new RpcHandler(methods, ws); // routes method messages, sends result or error
new Files(mongo, storage, options); // upload, read, locate, validate
new Shutdown(closable, proc, { graceMs }); // graceful stop
```

---

## Application Layer

`server/app.ts` is where the wiring lives, and it is the only place that decides real or nulled.

```ts
const app = App.create({ mongoUri, fileDir, port });
const app = App.createNull({ findResponses, scriptResponses });
```

Both return the same graph. `App` exposes `publications`, `methods` and `files`. The assembly that boots in production is the assembly the tests drive, so there is no second wiring to drift out of step.

---

## Output Tracking Replaces Spies

An `OutputTracker` subscribes to an emitter and collects what passed through it. It exposes one thing, `data`:

```ts
const tracker = ws.trackMessages();
// ... exercise the code ...
expect(tracker.data).toContainEqual({ type: 'ready', id: 'sub1', collection: 'files' });
```

A spy asks whether a function was called. A tracker asks what was produced. Rename a private method and the spy assertion breaks while the tracker assertion does not, because the tracker was never coupled to the implementation in the first place.

---

## Contract Tests Keep the Null Honest

A nulled wrapper is only useful while it behaves like the real one. The guard against drift is a shared contract: one list of behaviours, run twice, once against `create()` and once against `createNull()`.

`tests/infrastructure/fileStorageContract.ts` exports the list:

```ts
export function fileStorageContract(makeStorage: () => FileStorageWrapper): void {
  it('reports a saved file as existing', async () => {
    const storage = makeStorage();
    await storage.save('report.bam', Buffer.from('content'));
    expect(await storage.exists('report.bam')).toBe(true);
  });
  // ...
}
```

The fast suite runs it against the null:

```ts
fileStorageContract(() => FileStorageWrapper.createNull());
```

The integration suite runs the same list against the real file system:

```ts
fileStorageContract(() => FileStorageWrapper.create(TEST_DIR));
```

If the two ever disagree, one of them goes red. That is the whole mechanism, and it is why a nulled wrapper can be trusted.

---

## Test Stack

```json
{ "devDependencies": { "vitest": "^4.1" } }
```

Vitest, and nothing else. No supertest, no mocking library, no test containers.

---

## The Shape of the Suite

```
tests/
├── infrastructure/   wrappers: nullable tests, contract lists, narrow integration
├── logic/            publications, methods, rpcHandler, files, shutdown, analysis
├── client/           clientSocket, connectionManager, reactiveStore, uploader
├── server/           createServer routing, app wiring, and the full pipeline
└── shared/           protocol types and helpers
```

Nullable tests and integration tests live in separate files, `x.test.ts` and `x.integration.test.ts`, and that split is what keeps the fast suite honest. It never touches the network or the disk, so it can run on every save.

```bash
npm test                  # the fast suite: nullable and sociable tests
npm run test:integration  # narrow integration, needs a real local MongoDB
```

---

## What Replaces What

| Traditional               | Testing Without Mocks                                  |
| ------------------------- | ------------------------------------------------------ |
| `vi.mock('mongodb')`      | `MongoWrapper.createNull()`                            |
| `vi.spyOn(ws, 'send')`    | `ws.trackMessages()`, or the stubbed client's messages |
| Asserting a call happened | Asserting what was produced                            |
| A mock that drifts        | A contract test run against real and null              |
