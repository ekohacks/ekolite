# Story 3.A.2: Send Initial Documents on Subscribe

## What this story is about

When a client subscribes to a publication, they need to receive all the documents that currently exist for that query. This is the "initial data load" that happens before any live updates.

In Story 3.A.1 you handled the error case (unknown publication). Now you handle the happy path: a known publication queries MongoDB, sends each document to the client as an `added` message, and finishes with a `ready` signal so the client knows the initial load is complete.

Think of it like opening a chat app. When you open a conversation, you first see all the existing messages (initial data). Then new messages appear as they arrive (live updates, Story 3.A.3). This story is the "see all existing messages" part.

## What Meteor does today

```js
Meteor.publish('files.UserFiles.all', function () {
  return UserFiles.find().cursor;
});
```

When a client subscribes, Meteor automatically queries MongoDB, sends each document as an `added` DDP message, then sends `ready`. We're building this same flow explicitly.

## What already exists (read these files first)

| File                               | What it does                                                | Why you need to read it                               |
| ---------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| `server/logic/publications.ts`     | Your Publications class from Story 3.A.1                    | You're extending this                                 |
| `tests/logic/publications.test.ts` | Your existing test from 3.A.1                               | You're adding a new test here                         |
| `server/infrastructure/mongo.ts`   | MongoDB wrapper, specifically `createNull({ find: [...] })` | So you know how to seed the Null Mongo with documents |
| `shared/protocol.ts`               | `DataMsg` (added/changed/removed) and `ReadyMsg` types      | So you know the exact shape of messages to send       |

## What you need to build

Extend `Publications.handleMessage()` so that when a client subscribes to a **known** publication:

1. It calls the publication's query function to get the collection name and query
2. It calls `mongo.find()` with those parameters
3. It sends each document to the client as an `added` message (with `_id` separated into `id`)
4. It sends a `ready` message to signal the initial load is complete

## How to approach this (TDD)

### Step 1: Write the failing test

Add a new test to `tests/logic/publications.test.ts`:

```typescript
it('sends initial documents and ready signal on subscribe', async () => {
  const mongo = MongoWrapper.createNull({
    find: [[{ _id: '1', name: 'existing.bam' }]],
  });
  const ws = WebSocketWrapper.createNull();
  const client = ws.simulateConnection();
  const pubs = new Publications(mongo, ws);

  pubs.define('files.all', () => ({ collection: 'files', query: {} }));

  await pubs.handleMessage(client.id, {
    type: 'subscribe',
    id: 'sub1',
    name: 'files.all',
  });

  expect(client.messages).toContainEqual({
    type: 'added',
    collection: 'files',
    id: '1',
    fields: { name: 'existing.bam' },
  });
  expect(client.messages).toContainEqual({
    type: 'ready',
    id: 'sub1',
  });
});
```

Run it. It fails because your current `handleMessage` only handles the error case (unknown publication). It doesn't query Mongo or send documents. That's Red.

**What's happening in this test:**

1. `MongoWrapper.createNull({ find: [[...]] })` seeds the Null Mongo so the first call to `find()` returns `[{ _id: '1', name: 'existing.bam' }]`
2. The publication is defined with `collection: 'files'` and `query: {}`
3. After subscribing, `client.messages` should contain both an `added` message (the document) and a `ready` message (initial load complete)

**The `added` message shape matters.** Look at `DataMsg` in `shared/protocol.ts`. The `_id` field from MongoDB becomes the `id` field in the message, and the remaining fields go in `fields`. This separation is deliberate.

### Step 2: Write the GREEN code

In `handleMessage`, when the publication name IS found in the Map:

1. Call the query function: `const { collection, query } = queryFn()`
2. Call `await this.mongo.find(collection, query)`
3. For each document, separate `_id` from the rest and send an `added` message via `ws.send()`
4. Send a `ready` message

### Step 3: Refactor

Extract helper functions for building the messages:

- `toAddedMsg(collection, doc)` takes a raw MongoDB document, splits `_id` from the rest, returns a `DataMsg`
- `toReadyMsg(subId)` takes a subscription ID, returns a `ReadyMsg`

These helpers keep `handleMessage` clean and will be reused in Story 3.A.3.

Tests should still pass. If they go red, you changed behaviour.

### Step 4: Consider the edge case (optional, good practice)

What if the publication has no documents? Write a quick test:

```typescript
it('sends ready even when no documents exist', async () => {
  const mongo = MongoWrapper.createNull({
    find: [[]],
  });
  const ws = WebSocketWrapper.createNull();
  const client = ws.simulateConnection();
  const pubs = new Publications(mongo, ws);

  pubs.define('files.all', () => ({ collection: 'files', query: {} }));

  await pubs.handleMessage(client.id, {
    type: 'subscribe',
    id: 'sub1',
    name: 'files.all',
  });

  expect(client.messages).toHaveLength(1);
  expect(client.messages[0]).toEqual({ type: 'ready', id: 'sub1' });
});
```

This should already pass if your GREEN code is correct. If it does, it's not a real Red test, but it documents the expected behaviour. If it doesn't pass, fix the bug.

## File structure when you're done

```
server/
  logic/
    publications.ts          (updated from 3.A.1)

tests/
  logic/
    publications.test.ts     (updated, new test added)
```

## Definition of done

- [ ] Test for initial documents passes (`npm test`)
- [ ] `added` messages have the correct shape: `{ type: 'added', collection, id, fields }`
- [ ] `ready` message is sent after all documents: `{ type: 'ready', id: subId }`
- [ ] `_id` is separated from other fields (not duplicated in `fields`)
- [ ] `toAddedMsg` and `toReadyMsg` helper functions exist
- [ ] Error test from 3.A.1 still passes (regression check)
- [ ] No lint errors (`npm run lint`)

## Things to watch out for

- **Seed the Null Mongo correctly.** `createNull({ find: [[doc1, doc2]] })` means the first call to `find()` returns `[doc1, doc2]`. The outer array is the list of responses, the inner array is the list of documents. `createNull({ find: [[], [doc1]] })` means the first `find()` returns empty, the second returns one doc. Get the nesting right.
- **Separate `_id` from `fields`.** The `added` message has `id: doc._id` and `fields: { everything else }`. Use destructuring: `const { _id, ...fields } = doc`. Don't include `_id` inside `fields`.
- **The `ready` message uses the subscription ID**, not the document ID. The subscription ID is `msg.id` from the subscribe message (e.g. `'sub1'`).
- **Order matters.** Send all `added` messages first, then `ready`. The client uses `ready` to know when the initial batch is done.
