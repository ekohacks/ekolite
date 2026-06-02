# ekolite — TDD Engineering Guide

Start with [ekolite-overview.md](ekolite-overview.md) for the big picture. This is the TDD technical reference — Testing Without Mocks (James Shore's Nullable pattern). Read `ekolite-tdd-training.md` first for worked examples.

Reference: https://www.jamesshore.com/v2/projects/nullables/testing-without-mocks

---

## Core Principles

1. **No mocks.** Ever. Not for MongoDB, not for WebSocket, not for the file system.
2. **Nullables.** Every infrastructure wrapper has a `create()` and a `createNull()` factory. The Null version behaves identically but doesn't touch external systems.
3. **Sociable tests.** Tests use real dependency chains. If `Publications` depends on `MongoWrapper`, the test uses the real `Publications` with a Nulled `MongoWrapper`.
4. **State-based assertions.** Check outputs and state, not whether a function was called.
5. **A-Frame architecture.** Logic and infrastructure are peers. The application layer coordinates them.

---

## A-Frame Architecture for ekolite

```
         Application Layer
        (server/index.ts)
        /        |        \
       V         V         V
    Logic     Logic      Logic
  (pubsub)  (methods)  (upload)
       \        |        /
        V       V       V
      Infrastructure Wrappers
   Mongo  WebSocket  FileSystem  ScriptRunner
```

Logic doesn't import infrastructure directly. The application layer wires them together. This means logic is testable with Nulled infrastructure.

---

## Infrastructure Wrappers

Each external system gets a wrapper class with two factories:

### 1. MongoWrapper

Wraps the `mongodb` Node.js driver.

```ts
// server/infrastructure/mongo.ts

export class MongoWrapper {
  static create(uri: string): MongoWrapper {
    return new MongoWrapper(new RealMongoClient(uri));
  }

  static createNull(docs: Record<string, unknown[]> = {}): MongoWrapper {
    return new MongoWrapper(new StubbedMongoClient(docs));
  }

  async find<T>(collection: string, query: object): Promise<T[]> { ... }
  async insert(collection: string, doc: object): Promise<string> { ... }
  async update(collection: string, query: object, changes: object): Promise<void> { ... }
  async remove(collection: string, query: object): Promise<void> { ... }
  watchChanges(collection: string, listener: ChangeListener): void { ... }
}

// Embedded Stub — lives in the same file
class StubbedMongoClient {
  private store: Map<string, unknown[]>;
  private listeners: Map<string, ChangeListener[]>;

  constructor(initialDocs: Record<string, unknown[]>) {
    this.store = new Map(Object.entries(initialDocs));
    this.listeners = new Map();
  }

  // Implements the same interface as the real client
  // Stores documents in memory
  // Fires change listeners on insert/update/remove
}
```

### 2. WebSocketServer

Wraps `@fastify/websocket`.

```ts
// server/infrastructure/websocket.ts

export class WebSocketServer {
  static create(fastify: FastifyInstance): WebSocketServer {
    return new WebSocketServer(new RealWebSocketHandler(fastify));
  }

  static createNull(): WebSocketServer {
    return new WebSocketServer(new StubbedWebSocketHandler());
  }

  onConnection(handler: ConnectionHandler): void { ... }
  send(clientId: string, message: ServerMessage): void { ... }
  broadcast(message: ServerMessage): void { ... }

  // Output Tracking — observe what was sent without spying
  trackMessages(): MessageTracker { ... }
}

// Embedded Stub
class StubbedWebSocketHandler {
  private connections: Map<string, StubbedConnection>;

  // Simulates client connections in memory
  // simulateConnection() — creates a fake client
  // simulateMessage(clientId, msg) — simulates incoming message
}
```

### 3. FileStorage

Wraps Node.js `fs`.

```ts
// server/infrastructure/fileStorage.ts

export class FileStorage {
  static create(basePath: string): FileStorage {
    return new FileStorage(new RealFileSystem(basePath));
  }

  static createNull(): FileStorage {
    return new FileStorage(new StubbedFileSystem());
  }

  async save(name: string, data: Buffer): Promise<string> { ... }
  async exists(name: string): Promise<boolean> { ... }
  async remove(name: string): Promise<void> { ... }
  resolve(relativePath: string): string { ... }
}

// Embedded Stub
class StubbedFileSystem {
  private files: Map<string, Buffer>;
  // Stores files in memory, same interface as real fs operations
}
```

### 4. ScriptRunner

Wraps Node.js `child_process.execFile`.

```ts
// server/infrastructure/scriptRunner.ts

export class ScriptRunner {
  static create(): ScriptRunner {
    return new ScriptRunner(new RealProcessRunner());
  }

  static createNull(responses: Record<string, string> = {}): ScriptRunner {
    return new ScriptRunner(new StubbedProcessRunner(responses));
  }

  async exec(command: string, args: string[]): Promise<ScriptResult> { ... }
}

// Embedded Stub
class StubbedProcessRunner {
  constructor(private responses: Record<string, string>) {}
  // Returns configured responses based on command
  // No child processes spawned
}
```

---

## Logic Layer (No Infrastructure Knowledge)

Logic classes accept infrastructure wrappers via constructor. They don't know or care if they're real or Null.

### Publications

```ts
// server/logic/publications.ts

export class Publications {
  constructor(
    private mongo: MongoWrapper,
    private ws: WebSocketServer,
  ) {}

  define(name: string, queryFn: () => MongoQuery): void { ... }
  handleSubscribe(clientId: string, subId: string, name: string): void { ... }
  handleUnsubscribe(clientId: string, subId: string): void { ... }
}
```

### Methods

```ts
// server/logic/methods.ts

export class Methods {
  private registry: Map<string, MethodFn> = new Map();

  define(name: string, fn: MethodFn): void { ... }
  async call(name: string, params: unknown[]): Promise<unknown> { ... }
}
```

### UploadHandler

```ts
// server/logic/uploadHandler.ts

export class UploadHandler {
  constructor(
    private fileStorage: FileStorage,
    private mongo: MongoWrapper,
  ) {}

  async handle(file: UploadedFile): Promise<StoredFile> { ... }
  validate(file: UploadedFile): boolean { ... }
}
```

---

## Application Layer (Wires Everything Together)

```ts
// server/index.ts

export class App {
  static create(config: AppConfig): App {
    return new App(
      MongoWrapper.create(config.mongoUri),
      WebSocketServer.create(config.fastify),
      FileStorage.create(config.uploadPath),
      ScriptRunner.create(),
    );
  }

  static createNull(options: NullAppOptions = {}): App {
    return new App(
      MongoWrapper.createNull(options.docs),
      WebSocketServer.createNull(),
      FileStorage.createNull(),
      ScriptRunner.createNull(options.scriptResponses),
    );
  }

  constructor(
    private mongo: MongoWrapper,
    private ws: WebSocketServer,
    private files: FileStorage,
    private scripts: ScriptRunner,
  ) {
    this.publications = new Publications(mongo, ws);
    this.methods = new Methods();
    this.uploads = new UploadHandler(files, mongo);
  }
}
```

---

## Test Stack

```json
{
  "devDependencies": {
    "vitest": "^3.0"
  }
}
```

Just vitest. No supertest, no mock libraries, no test containers. Nullables replace all of that.

---

## Tests

### Infrastructure Wrapper Tests (Narrow Integration)

These are the **only tests that touch real external systems**. Run against a real local MongoDB, real file system, real WebSocket. They verify the wrappers work correctly.

```ts
// tests/infrastructure/mongo.test.ts

describe('MongoWrapper (narrow integration)', () => {
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

  it('fires change listener on insert', async () => {
    const changes: ChangeEvent[] = [];
    mongo.watchChanges('testDocs', (event) => changes.push(event));

    await mongo.insert('testDocs', { name: 'new.bam' });

    // Wait for change stream
    await eventually(() => {
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe('insert');
    });
  });
});
```

```ts
// tests/infrastructure/fileStorage.test.ts

describe('FileStorage (narrow integration)', () => {
  const storage = FileStorage.create('/tmp/ekolite-test');

  afterEach(async () => {
    await storage.remove('test.bam');
  });

  it('saves and checks file existence', async () => {
    await storage.save('test.bam', Buffer.from('content'));
    expect(await storage.exists('test.bam')).toBe(true);
  });
});
```

### Nullable Parity Tests

Verify that the Null version behaves the same as the real version. Run the **same test suite** against both.

```ts
// tests/infrastructure/mongo.parity.ts

function mongoParityTests(createMongo: () => MongoWrapper) {
  describe('insert and find', () => {
    it('returns inserted documents', async () => {
      const mongo = createMongo();
      await mongo.insert('files', { name: 'a.bam' });
      const docs = await mongo.find('files', {});
      expect(docs).toHaveLength(1);
      expect(docs[0].name).toBe('a.bam');
    });
  });

  describe('change events', () => {
    it('fires on insert', async () => {
      const mongo = createMongo();
      const changes: ChangeEvent[] = [];
      mongo.watchChanges('files', (e) => changes.push(e));

      await mongo.insert('files', { name: 'b.bam' });

      await eventually(() => {
        expect(changes[0].type).toBe('insert');
      });
    });
  });
}

// Run against real
describe('MongoWrapper (real)', () => {
  mongoParityTests(() => MongoWrapper.create('mongodb://localhost:27017/test'));
});

// Run against Null
describe('MongoWrapper (null)', () => {
  mongoParityTests(() => MongoWrapper.createNull());
});
```

### Logic Tests (Sociable, Using Nullables)

These tests instantiate real logic classes with Nulled infrastructure. Fast, no external systems, no mocks.

```ts
// tests/logic/publications.test.ts

describe('Publications', () => {
  it('sends initial documents on subscribe', async () => {
    const mongo = MongoWrapper.createNull({
      files: [{ _id: '1', name: 'existing.bam' }],
    });
    const ws = WebSocketServer.createNull();
    const pubs = new Publications(mongo, ws);
    const tracker = ws.trackMessages();

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    const client = ws.simulateConnection();
    ws.simulateMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(tracker.messagesTo(client.id)).toContainEqual({
      type: 'added',
      collection: 'files',
      id: '1',
      fields: { name: 'existing.bam' },
    });
    expect(tracker.messagesTo(client.id)).toContainEqual({
      type: 'ready',
      id: 'sub1',
    });
  });

  it('pushes changes when documents are inserted', async () => {
    const mongo = MongoWrapper.createNull();
    const ws = WebSocketServer.createNull();
    const pubs = new Publications(mongo, ws);
    const tracker = ws.trackMessages();

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    const client = ws.simulateConnection();
    ws.simulateMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    await mongo.insert('files', { _id: '2', name: 'new.bam' });

    expect(tracker.messagesTo(client.id)).toContainEqual({
      type: 'added',
      collection: 'files',
      id: '2',
      fields: { name: 'new.bam' },
    });
  });
});
```

```ts
// tests/logic/methods.test.ts

describe('Methods', () => {
  it('registers and calls a method', async () => {
    const methods = new Methods();
    methods.define('echo', async (msg: string) => `echo: ${msg}`);
    const result = await methods.call('echo', ['hello']);
    expect(result).toBe('echo: hello');
  });

  it('throws structured error for unknown method', async () => {
    const methods = new Methods();
    await expect(methods.call('nope', [])).rejects.toMatchObject({
      code: 404,
      message: 'Method not found: nope',
    });
  });
});
```

```ts
// tests/logic/methods-rpc.test.ts

describe('Methods over WebSocket', () => {
  it('receives result message', async () => {
    const ws = WebSocketServer.createNull();
    const methods = new Methods();
    methods.define('echo', async (msg: string) => `echo: ${msg}`);
    const rpc = new RpcHandler(methods, ws);
    const tracker = ws.trackMessages();

    const client = ws.simulateConnection();
    ws.simulateMessage(client.id, {
      type: 'method',
      id: 'm1',
      name: 'echo',
      params: ['test'],
    });

    await eventually(() => {
      expect(tracker.messagesTo(client.id)).toContainEqual({
        type: 'result',
        id: 'm1',
        result: 'echo: test',
      });
    });
  });
});
```

```ts
// tests/logic/uploadHandler.test.ts

describe('UploadHandler', () => {
  it('stores file and saves metadata', async () => {
    const files = FileStorage.createNull();
    const mongo = MongoWrapper.createNull();
    const handler = new UploadHandler(files, mongo);

    const result = await handler.handle({
      name: 'sample.bam',
      data: Buffer.from('bam content'),
      size: 11,
    });

    expect(result.name).toBe('sample.bam');
    expect(await files.exists('sample.bam')).toBe(true);

    const docs = await mongo.find('UserFiles', {});
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('sample.bam');
  });

  it('rejects non-.bam files', async () => {
    const files = FileStorage.createNull();
    const mongo = MongoWrapper.createNull();
    const handler = new UploadHandler(files, mongo);

    await expect(
      handler.handle({
        name: 'bad.txt',
        data: Buffer.from('not bam'),
        size: 7,
      }),
    ).rejects.toMatchObject({ code: 400 });

    expect(await files.exists('bad.txt')).toBe(false);
  });
});
```

```ts
// tests/logic/scriptRunner.test.ts

describe('ScriptRunner with Methods', () => {
  it('runs configured script and returns output', async () => {
    const scripts = ScriptRunner.createNull({
      python3: 'count: 42',
    });
    const methods = new Methods();
    const fileStorage = FileStorage.createNull();

    methods.define('runCountC', async (targetPath: string) => {
      const scriptPath = fileStorage.resolve('scripts/countC.py');
      const result = await scripts.exec('python3', [scriptPath, targetPath]);
      return result.stdout;
    });

    const result = await methods.call('runCountC', ['/uploads']);
    expect(result).toBe('count: 42');
  });
});
```

### Application Tests (Full Wiring, Still Nulled)

```ts
// tests/app.test.ts

describe('App', () => {
  it('creates with all Nulled infrastructure', () => {
    const app = App.createNull();
    expect(app).toBeDefined();
  });

  it('full pipeline: upload → subscribe → method', async () => {
    const app = App.createNull({
      scriptResponses: { python3: 'count: 7' },
    });
    const tracker = app.ws.trackMessages();

    // 1. Client connects and subscribes
    const client = app.ws.simulateConnection();
    app.ws.simulateMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'UserFiles.all',
    });

    // 2. Upload a file
    const stored = await app.uploads.handle({
      name: 'test.bam',
      data: Buffer.from('bam data'),
      size: 8,
    });

    // 3. Client should see the file via pub/sub
    expect(tracker.messagesTo(client.id)).toContainEqual(
      expect.objectContaining({ type: 'added', collection: 'UserFiles' }),
    );

    // 4. Call analysis method
    app.ws.simulateMessage(client.id, {
      type: 'method',
      id: 'm1',
      name: 'runCountC',
      params: [stored.path],
    });

    await eventually(() => {
      expect(tracker.messagesTo(client.id)).toContainEqual({
        type: 'result',
        id: 'm1',
        result: 'count: 7',
      });
    });
  });
});
```

### Client-Side Tests (Sociable, Nulled WebSocket)

```ts
// tests/client/store.test.ts

describe('ReactiveStore', () => {
  it('adds document and emits change', () => {
    const store = new ReactiveStore<{ _id: string; name: string }>();
    const changes: unknown[] = [];
    store.on('change', (docs) => changes.push(docs));

    store.handleMessage({
      type: 'added',
      collection: 'files',
      id: '1',
      fields: { name: 'a.bam' },
    });

    expect(store.getAll()).toEqual([{ _id: '1', name: 'a.bam' }]);
    expect(changes).toHaveLength(1);
  });

  it('updates document on changed message', () => {
    const store = new ReactiveStore<{ _id: string; name: string }>();
    store.handleMessage({
      type: 'added',
      collection: 'files',
      id: '1',
      fields: { name: 'a.bam' },
    });
    store.handleMessage({
      type: 'changed',
      collection: 'files',
      id: '1',
      fields: { name: 'b.bam' },
    });

    expect(store.getById('1')?.name).toBe('b.bam');
  });

  it('removes document on removed message', () => {
    const store = new ReactiveStore<{ _id: string; name: string }>();
    store.handleMessage({
      type: 'added',
      collection: 'files',
      id: '1',
      fields: { name: 'a.bam' },
    });
    store.handleMessage({ type: 'removed', collection: 'files', id: '1' });

    expect(store.getAll()).toEqual([]);
  });
});
```

---

## Test Structure

```
tests/
├── infrastructure/          # Narrow integration — real external systems
│   ├── mongo.test.ts
│   ├── mongo.parity.ts      # Same tests run against real AND null
│   ├── fileStorage.test.ts
│   ├── fileStorage.parity.ts
│   ├── websocket.test.ts
│   └── scriptRunner.test.ts
├── logic/                   # Sociable tests — Nulled infrastructure
│   ├── publications.test.ts
│   ├── methods.test.ts
│   ├── methods-rpc.test.ts
│   ├── uploadHandler.test.ts
│   └── scriptRunner.test.ts
├── client/                  # Client-side — no external systems
│   ├── store.test.ts
│   ├── connection.test.ts
│   └── call.test.ts
└── app.test.ts              # Full wiring — all Nulled
```

---

## Test Pyramid

```
                 ┌──────────┐
                 │ Narrow   │  4 test files — real MongoDB, real fs
                 │ Integr.  │  SLOW — run in CI or manually
                 ├──────────┤
                 │ Parity   │  4 test files — same tests, real vs null
                 │          │  Proves Nullables match real behavior
            ┌────┴──────────┴────┐
            │   Logic (Sociable) │  5+ test files — Nulled infra
            │   + Client tests   │  FAST — run on every save
            ├────────────────────┤
            │   App (Full Null)  │  1 test file — everything wired
            │                    │  FAST — run on every save
            └────────────────────┘
```

---

## What Replaces What

| Traditional Approach      | Testing Without Mocks                            |
| ------------------------- | ------------------------------------------------ |
| `jest.mock('mongodb')`    | `MongoWrapper.createNull()`                      |
| `jest.spyOn(ws, 'send')`  | `ws.trackMessages()` (Output Tracking)           |
| `jest.fn()` for callbacks | Real callbacks, check state                      |
| Mock file system          | `FileStorage.createNull()` (in-memory)           |
| Mock child_process        | `ScriptRunner.createNull({ responses })`         |
| Test containers / docker  | Narrow integration tests (local MongoDB)         |
| Supertest for HTTP        | `app.ws.simulateMessage()` (Behavior Simulation) |

---

## TDD Rules

1. **Red → Green → Refactor.** No exceptions.
2. **No mocks.** Use Nullables. If you reach for `vi.mock()`, stop and write a Nullable instead.
3. **Parity tests for every wrapper.** If the Null version drifts from the real version, bugs hide.
4. **Logic tests are fast.** They use Nulled infrastructure. If a logic test takes >50ms, something is wrong.
5. **Narrow integration tests are slow.** That's fine. Run them separately. They prove the wrappers work.
6. **State, not interactions.** Assert on what happened, not how it happened.
7. **Output Tracking over spying.** Use `trackMessages()`, `trackFiles()`, etc. — built into the wrappers.
8. **One story at a time.** Don't jump ahead.

---

## Build Order (Test-First)

| Order | What to Build                     | Test With                       | Story |
| :---: | --------------------------------- | ------------------------------- | :---: |
|   1   | `MongoWrapper` + Null + parity    | Narrow integration + parity     |   —   |
|   2   | `WebSocketServer` + Null + parity | Narrow integration + parity     |   —   |
|   3   | `FileStorage` + Null + parity     | Narrow integration + parity     |   —   |
|   4   | `ScriptRunner` + Null + parity    | Narrow integration + parity     |   —   |
|   5   | Fastify serves static files       | Narrow integration              |   1   |
|   6   | WebSocket connection via Fastify  | Narrow integration              |   2   |
|   7   | `Publications` logic              | Sociable (Nulled mongo + ws)    |   3   |
|   8   | `ReactiveStore` client            | Unit (no infra)                 |   3   |
|   9   | `Methods` logic                   | Sociable (Nulled)               |   4   |
|  10   | `RpcHandler` (methods over WS)    | Sociable (Nulled ws)            |   4   |
|  11   | `UploadHandler` logic             | Sociable (Nulled files + mongo) | 5, 6  |
|  12   | `App` full wiring                 | All Nulled                      |   7   |

---

## Running Tests

```bash
# Fast tests (logic + client + app) — run on every save
vitest --watch --exclude='**/infrastructure/**'

# Narrow integration tests — run manually or in CI
vitest tests/infrastructure/

# All tests
vitest

# Type check
tsc --noEmit
```
