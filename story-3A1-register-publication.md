# Story 3.A.1: Register a Publication

## What this story is about

This is the first step in building the Publications system. Before a client can subscribe to live data, the server needs a way to define what publications exist and reject requests for ones that don't.

Right now, EkoLite has no concept of publications. A client can connect via WebSocket (Story 2.B) but can't ask for data. This story creates the `Publications` class with a `define()` method for registering publications and a `handleMessage()` method that rejects unknown names with a structured error.

Think of it like a restaurant menu. Before you can order anything, the restaurant needs a menu. And if you order something that isn't on the menu, you should get told it doesn't exist. That's what this story builds.

## What Meteor does today

```js
Meteor.publish('files.UserFiles.all', function () {
  return UserFiles.find().cursor;
});
```

Meteor lets you define a publication by name. If a client subscribes to a name that doesn't exist, Meteor sends back an error. We're building the same thing, but explicitly.

## What already exists (read these files first)

Before writing any code, read and understand these files. They're the foundation you're building on.

| File                                      | What it does                                                                      | Why you need to read it                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `shared/protocol.ts`                      | Defines the 6 message types (subscribe, unsubscribe, method, ready, added, error) | So you know the shape of subscribe and error messages                               |
| `shared/types.ts`                         | Shared types including `ChangeEvent`                                              | So you know what types exist already                                                |
| `server/infrastructure/websocket.ts`      | WebSocket wrapper with `createNull()`, `simulateConnection()`, `send()`           | So you understand how to simulate clients and check messages in tests               |
| `server/infrastructure/mongo.ts`          | MongoDB wrapper with `createNull()`, `find()`, `insert()`                         | Publications will need this later (Story 3.A.2) but read it now so you know the API |
| `server/infrastructure/output_tracker.ts` | EventEmitter, OutputTracker, ConfigurableResponse                                 | So you understand the tracking pattern used in tests                                |
| `tests/infrastructure/websocket.test.ts`  | Existing WebSocket tests                                                          | So you can see the test style and how `simulateConnection` is used                  |

## What you need to build

A `Publications` class in `server/logic/publications.ts` that:

1. **Defines publications** via `define(name, queryFn)` storing them in a Map
2. **Handles incoming messages** via `handleMessage(clientId, message)` checking the message type
3. **Sends an error** when a client subscribes to an unknown publication name

This story only handles the error case. Successful subscriptions come in Story 3.A.2.

## How to approach this (TDD)

You will write the test first. It should fail (red) before you write the production code to make it pass (green). Then refactor.

### Step 1: Create the test file

Create `tests/logic/publications.test.ts`.

This is a **sociable test** using Nulled infrastructure. No real MongoDB, no real WebSocket. Everything runs in memory, fast.

### Step 2: Write the failing test

Write one test that describes the error case: subscribe to a name that hasn't been defined, check that an error message was sent back.

```typescript
import { describe, it, expect } from 'vitest';
import { Publications } from '../../server/logic/publications.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

describe('Publications', () => {
  it('sends error when subscribing to unknown publication', async () => {
    const mongo = MongoWrapper.createNull();
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'nonexistent',
    });

    expect(client.messages).toContainEqual({
      type: 'error',
      id: 'sub1',
      error: { code: 404, message: 'Unknown publication: nonexistent' },
    });
  });
});
```

Run it: `npx vitest run tests/logic/publications.test.ts`

It fails: `Cannot find module '../../server/logic/publications.ts'`. Good. That's Red.

**What's happening in this test:**

1. `MongoWrapper.createNull()` creates an in-memory Mongo (no real database)
2. `WebSocketWrapper.createNull()` creates an in-memory WebSocket server
3. `ws.simulateConnection()` creates a fake client and returns a `StubbedClient` with an `id` and a `messages` array
4. `new Publications(mongo, ws)` creates the class you're about to build
5. `pubs.handleMessage(client.id, msg)` sends a subscribe message to Publications
6. `client.messages` is an array of everything the server sent back to that client via `ws.send()`

Notice there's no `vi.mock()`, no `vi.spyOn()`. You're testing real code with in-memory infrastructure. The `StubbedClient.messages` array collects everything `ws.send()` sends to that client.

### Step 3: Write the GREEN code

Create `server/logic/publications.ts`. Write the minimum code to make the test pass:

- A class that accepts `MongoWrapper` and `WebSocketWrapper` in its constructor
- A `define(name, queryFn)` method that stores entries in a Map
- A `handleMessage(clientId, message)` method that checks the message type
- If `type === 'subscribe'` and the name isn't in the Map, send an error via `ws.send()`

The error shape should match `ErrorMsg` from `shared/protocol.ts`.

### Step 4: Refactor

Extract a `PublicationDef` type for the Map values. The query function returns a collection name and query object:

```typescript
type PublicationDef = () => { collection: string; query: object };
```

Export it if you think other modules will need it.

Tests should still pass after refactoring. If they go red, you changed behaviour. Undo and try again.

## File structure when you're done

```
server/
  logic/
    publications.ts          (new)

tests/
  logic/
    publications.test.ts     (new)
```

## Definition of done

- [ ] Test in `publications.test.ts` passes (`npm test`)
- [ ] `Publications` class exists with `define()` and `handleMessage()`
- [ ] Unknown publication name sends `{ type: 'error', id, error: { code: 404, message } }`
- [ ] `PublicationDef` type is extracted
- [ ] No lint errors (`npm run lint`)

## Things to watch out for

- **Don't import from `ws` in your logic class.** Publications should only know about `WebSocketWrapper`, never the raw WebSocket library. That's the whole point of the wrapper.
- **`handleMessage` should be async.** Even though this first test doesn't need it, later stories (3.A.2, 3.A.3) will do async work inside it. Make it `async` now to avoid refactoring later.
- **The error shape matters.** Look at `ErrorMsg` in `shared/protocol.ts`. The structure is `{ type: 'error', id: string, error: { code, message } }`. Get it right, the client depends on this shape.
- **Don't add handling for `unsubscribe` yet.** That's Story 3.A.4. Only handle `subscribe` for now. If a different message type comes in, do nothing (or ignore it silently).
