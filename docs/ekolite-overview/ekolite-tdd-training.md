# ekolite — TDD Training Guide

Start with [ekolite-overview.md](ekolite-overview.md) for the big picture. This document teaches the red-green-refactor loop and how it works with Testing Without Mocks. See `ekolite-tdd.md` for the technical reference.

---

## 1. What Is Red-Green-Refactor

Every piece of production code starts with a failing test. The loop has three phases:

```
  ┌──────────────────────────────────────────────┐
  │                                              │
  │   RED ──────► GREEN ──────► REFACTOR ──┐     │
  │   write a      write the     improve   │     │
  │   failing      minimum       structure │     │
  │   test         code to       without   │     │
  │                pass          changing   │     │
  │                              behavior  │     │
  │                                        │     │
  │            ◄────────────────────────────┘     │
  │            next failing test                  │
  └──────────────────────────────────────────────┘
```

**Red:** Write a test that describes the behavior you want. Run it. It must fail. If it passes, you either wrote the wrong test or the behavior already exists.

**Green:** Write the simplest, dumbest code that makes the test pass. No cleverness. No "while I'm here" additions. Just make the red go green.

**Refactor:** Now that the test is green, improve the code's structure. Rename variables, extract helpers, remove duplication. The tests stay green throughout. If they go red, you changed behavior — undo and try again.

**Cycle time:** Each red-green-refactor cycle should take **5–20 minutes**. If you've been in "Red" for 30 minutes, your test is too ambitious — write a smaller one.

---

## 2. How It Works with Nullables (No Mocks)

This project uses **Testing Without Mocks** (James Shore). There are no `vi.mock()`, no `vi.spyOn()`, no test doubles. Instead:

**Infrastructure wrappers** have two factories:

- `create()` — connects to real external systems (MongoDB, file system, WebSocket)
- `createNull()` — behaves identically but uses in-memory implementations

See ADR-008 and ADR-009 for why we made this choice.

### How Nullables work in each phase

**In the Red phase** for a logic test:

```ts
// You instantiate real logic with Nulled infrastructure
const mongo = MongoWrapper.createNull({ files: [{ _id: '1', name: 'a.bam' }] });
const ws = WebSocketServer.createNull();
const pubs = new Publications(mongo, ws);

// You write an assertion about output or state
const tracker = ws.trackMessages();
// ... trigger behavior ...
expect(tracker.messagesTo(client.id)).toContainEqual({ type: 'ready', id: 'sub1' });
```

**In the Green phase:** Implement the logic method. The Null infrastructure handles the external system behavior — you don't need to configure anything beyond seed data.

**In the Refactor phase:** Extract helpers, rename for clarity, simplify the Null configuration. Tests stay green.

### Output Tracking replaces spies

| Traditional                                 | Nullables                                            |
| ------------------------------------------- | ---------------------------------------------------- |
| `vi.spyOn(ws, 'send')`                      | `ws.trackMessages()`                                 |
| `expect(ws.send).toHaveBeenCalledWith(...)` | `expect(tracker.messagesTo(id)).toContainEqual(...)` |

The difference: spies check _whether a function was called_. Output Tracking checks _what was produced_. You test state, not interactions.

### The four kinds of tests in this project

| Test Kind              | What It Tests                                        | Uses Real Systems? | Speed | When to Run    |
| ---------------------- | ---------------------------------------------------- | ------------------ | ----- | -------------- |
| **Narrow integration** | Infrastructure wrappers work with real MongoDB/fs/ws | Yes                | Slow  | CI or manually |
| **Parity**             | Null version behaves same as real version            | Yes (runs both)    | Slow  | CI or manually |
| **Sociable (logic)**   | Business logic with Nulled infrastructure            | No                 | Fast  | On every save  |
| **Client-side**        | ReactiveStore, subscribe, call, upload               | No                 | Fast  | On every save  |

See `ekolite-tdd.md` for the full test pyramid and file structure.

---

## 3. Common Mistakes to Avoid

| Mistake                                | Why It's Wrong                                                                                 | What to Do Instead                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Reaching for `vi.mock()`               | Breaks the Nullable contract; hides real behavior                                              | Write a `createNull()` with seed data                           |
| Writing implementation before the test | You can't know the test is testing the right thing if it never failed                          | Always start with Red                                           |
| Making the Green step clever           | You'll refactor later — clever code in Green means you're doing two things at once             | Write the dumbest code that passes                              |
| Skipping Refactor because "it works"   | Technical debt accumulates; the whole point of Green being dumb is that Refactor makes it good | Always take the Refactor step, even if it's "nothing to change" |

---

## 4. Worked Example: Methods.define and Methods.call

This walks through **Developer Story 4.A.1** from the backlog — the simplest logic class in the project. No infrastructure dependencies. Pure TDD.

### Why this example

`Methods` is the best teaching example because:

- Zero infrastructure dependencies (no Mongo, no WebSocket)
- Two behaviors to implement (define/call + error handling)
- Two clean red-green-refactor cycles
- Maps directly to Meteor's `Meteor.methods()` / `Meteor.call()` (see System Design, Concept #8 and #9)

---

### Cycle 1: Define and call a method

**RED** — Write the test first (`tests/logic/methods.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { Methods } from '../../server/logic/methods';

describe('Methods', () => {
  it('registers and calls a method', async () => {
    const methods = new Methods();
    methods.define('echo', async (msg: string) => `echo: ${msg}`);
    const result = await methods.call('echo', ['hello']);
    expect(result).toBe('echo: hello');
  });
});
```

Run it: `vitest tests/logic/methods.test.ts`

It fails: `Cannot find module '../../server/logic/methods'`. Good. That's Red.

**What happened:** The module doesn't exist yet. The test describes the behavior we want: define a method by name, call it by name, get the result.

**GREEN** — Write the minimum code (`server/logic/methods.ts`):

```ts
type MethodFn = (...args: any[]) => Promise<unknown>;

export class Methods {
  private registry = new Map<string, MethodFn>();

  define(name: string, fn: MethodFn): void {
    this.registry.set(name, fn);
  }

  async call(name: string, params: unknown[]): Promise<unknown> {
    const fn = this.registry.get(name)!;
    return fn(...params);
  }
}
```

Run the test. It passes. That's Green.

**What happened:** A Map stores functions by name. `call()` looks up the function and invokes it with the params. Simplest thing that works.

**REFACTOR** — The code is small and clear. Export the `MethodFn` type so other modules can use it:

```ts
export type MethodFn = (...args: any[]) => Promise<unknown>;
```

Tests still pass. Done.

**What happened:** We noticed `MethodFn` will be needed by `RpcHandler` later (see Story 4.B). Exporting it now is a small structural improvement.

---

### Cycle 2: Error on unknown method

**RED** — Add a second test:

```ts
it('throws structured error for unknown method', async () => {
  const methods = new Methods();
  await expect(methods.call('nope', [])).rejects.toMatchObject({
    code: 404,
    message: 'Method not found: nope',
  });
});
```

Run it. It fails: `Cannot read properties of undefined (reading 'apply')` because `registry.get()` returns `undefined` and we call `fn(...params)` on it. That's Red.

**What happened:** We discovered the current code doesn't handle missing methods. The test defines what should happen: a structured error with code 404.

**GREEN** — Add a guard clause:

```ts
async call(name: string, params: unknown[]): Promise<unknown> {
  const fn = this.registry.get(name);
  if (!fn) {
    throw { code: 404, message: `Method not found: ${name}` };
  }
  return fn(...params);
}
```

Test passes. That's Green.

**What happened:** One `if` statement. The error shape matches `MeteorLightError` from the spec. No extra framework — just a plain object.

**REFACTOR** — Extract error creation into a helper:

```ts
function methodNotFound(name: string) {
  return { code: 404, message: `Method not found: ${name}` };
}
```

Tests still pass. Two cycles, two behaviors, clean code. That's the loop.

---

### What this connects to

| What we just built                | Meteor equivalent                    | Backlog reference     |
| --------------------------------- | ------------------------------------ | --------------------- |
| `Methods.define('echo', fn)`      | `Meteor.methods({ echo() { ... } })` | Developer Story 4.A.1 |
| `Methods.call('echo', ['hello'])` | `Meteor.call('echo', 'hello')`       | Developer Story 4.A.1 |
| Structured error `{ code: 404 }`  | `Meteor.Error('not-found', ...)`     | Developer Story 4.A.2 |

Next step in the backlog: Story 4.B wires this to WebSocket via `RpcHandler`, so clients can call methods over the network.

---

## 5. Worked Example: Publications with Nulled Infrastructure

This walks through **Developer Story 3.A.2** — the first story that uses Nulled infrastructure. It shows how the Red-Green-Refactor loop works when external systems are involved.

### Why this example

`Publications.handleSubscribe` depends on both `MongoWrapper` and `WebSocketServer`. In traditional testing you'd mock both. Here we use `createNull()` instead.

---

### Cycle 1: Send initial documents on subscribe

**RED** — Write the test (`tests/logic/publications.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { Publications } from '../../server/logic/publications';
import { MongoWrapper } from '../../server/infrastructure/mongo';
import { WebSocketServer } from '../../server/infrastructure/websocket';

describe('Publications', () => {
  it('sends initial documents on subscribe', async () => {
    // Arrange — Nulled infrastructure with seed data
    const mongo = MongoWrapper.createNull({
      files: [{ _id: '1', name: 'existing.bam' }],
    });
    const ws = WebSocketServer.createNull();
    const pubs = new Publications(mongo, ws);
    const tracker = ws.trackMessages();

    // Define a publication
    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    // Act — simulate a client subscribing
    const client = ws.simulateConnection();
    ws.simulateMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    // Assert — client received the document and a ready signal
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
});
```

Run it. Fails because `Publications` class doesn't exist. Red.

**What's different from the Methods example:**

- We create Nulled `MongoWrapper` with seed data — no real MongoDB
- We create Nulled `WebSocketServer` — no real WebSocket
- We use `simulateConnection()` and `simulateMessage()` — behavior simulation
- We use `trackMessages()` — output tracking instead of spies
- All of this is **real code** running in-memory, not mocks

**GREEN** — Implement Publications:

```ts
export class Publications {
  private definitions = new Map<string, PublicationDef>();

  constructor(
    private mongo: MongoWrapper,
    private ws: WebSocketServer,
  ) {
    this.ws.onMessage((clientId, msg) => {
      if (msg.type === 'subscribe') {
        this.handleSubscribe(clientId, msg.id, msg.name);
      }
    });
  }

  define(name: string, queryFn: () => MongoQuery): void {
    this.definitions.set(name, queryFn);
  }

  private async handleSubscribe(clientId: string, subId: string, name: string): Promise<void> {
    const queryFn = this.definitions.get(name);
    if (!queryFn) {
      this.ws.send(clientId, {
        type: 'error',
        id: subId,
        error: { code: 404, message: `Unknown publication: ${name}` },
      });
      return;
    }

    const { collection, query } = queryFn();
    const docs = await this.mongo.find(collection, query);

    for (const doc of docs) {
      const { _id, ...fields } = doc;
      this.ws.send(clientId, { type: 'added', collection, id: _id, fields });
    }

    this.ws.send(clientId, { type: 'ready', id: subId });
  }
}
```

Test passes. Green.

**REFACTOR** — Extract message builders:

```ts
function toAddedMsg(collection: string, doc: any): DataMsg {
  const { _id, ...fields } = doc;
  return { type: 'added', collection, id: _id, fields };
}

function toReadyMsg(subId: string): ReadyMsg {
  return { type: 'ready', id: subId };
}
```

Tests still pass. Clean.

**Key insight:** The test is fast (no I/O), readable (Arrange-Act-Assert), and tests real behavior (actual Publications logic running with in-memory infrastructure). No mocks, no spies, no fragility.

---

## 6. How to Read a Developer Story's Sub-stories

Every developer story in the backlog (tracked in Linear; the original written backlog is archived at `../archive/ekolite-backlog.md`) has sub-stories labeled **a**, **b**, **c**:

| Sub-story | Phase    | What you do                                                  |
| --------- | -------- | ------------------------------------------------------------ |
| **a**     | Red      | Write the failing test. Run it. See it fail.                 |
| **b**     | Green    | Write the minimum code to make it pass. Run it. See it pass. |
| **c**     | Refactor | Improve structure. Run tests. Still green.                   |

Example from backlog:

> **Developer Story 0.A.1: Basic CRUD operations**
>
> - Sub-story 0.A.1a — Red: Write narrow integration test: insert, find, assert length 1
> - Sub-story 0.A.1b — Green: Implement MongoWrapper with real driver
> - Sub-story 0.A.1c — Refactor: Extract connection logic, write parity test

Each sub-story is one phase of the loop. You do them in order: a → b → c → move to next developer story.
