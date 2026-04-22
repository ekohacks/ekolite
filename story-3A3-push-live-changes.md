# Story 3.A.3: Push Live Changes

## What this story is about

Story 3.A.2 sends documents that already exist when a client subscribes. But what about documents that are inserted _after_ the client subscribes? That's what this story handles.

When a client is subscribed to a publication and a new document is inserted into MongoDB, the server should automatically push an `added` message to that client without the client asking for it. This is the "live" in "live data".

This is the core of real time. Without this, the client would need to keep resubscribing (polling) to see new data. With this, the server pushes changes the instant they happen.

## What Meteor does today

Meteor uses MongoDB oplog tailing to detect changes and automatically pushes them to all subscribed clients. We're using change events on the Mongo wrapper to achieve the same thing.

## What already exists (read these files first)

| File                                      | What it does                                                  | Why you need to read it                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/logic/publications.ts`            | Your Publications class with `define()` and `handleMessage()` | You're extending this to watch for changes                                                                                                                   |
| `tests/logic/publications.test.ts`        | Your existing tests (error + initial docs)                    | You're adding a new test here                                                                                                                                |
| `server/infrastructure/mongo.ts`          | Look at `StubbedMongoClient.insert()` specifically            | See how it emits a `ChangeEvent` via the internal EventEmitter when a document is inserted. This is what you need to react to                                |
| `server/infrastructure/output_tracker.ts` | `EventEmitter` and `OutputTracker`                            | Understand the event system. `trackChanges()` uses `OutputTracker` which records events, but you need a _callback_ approach to react to changes in real time |
| `shared/types.ts`                         | `ChangeEvent` type: `{ type, collection, id, fields }`        | This is the shape of change events emitted by Mongo                                                                                                          |

## What you need to build

After sending the initial documents (Story 3.A.2), Publications should start watching for changes on the collection. When a document is inserted, updated, or removed, it should send the corresponding message (`added`, `changed`, `removed`) to all clients subscribed to that publication.

This story focuses on `insert` (the `added` case). Update and remove follow the same pattern and can be tested separately or together.

## The gap you'll discover

When you write the failing test, you'll realise that `MongoWrapper` currently has `trackChanges(collection)` which returns an `OutputTracker`. OutputTracker records events in an array for testing. But Publications needs a **callback** to react when changes happen in real time.

You have two options:

1. Add a `watchChanges(collection, callback)` method to `MongoWrapper`
2. Find another way to listen to the Mongo EventEmitter

Option 1 is cleaner. It parallels how the real MongoDB driver works (change streams use callbacks). The Null version just wires the callback to the internal EventEmitter. This is GREEN work, so you'll figure out the details when you get there.

## How to approach this (TDD)

### Step 1: Write the failing test

Add a new test to `tests/logic/publications.test.ts`:

```typescript
it('pushes live changes to subscribed clients', async () => {
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

  const countAfterSubscribe = client.messages.length;

  await mongo.insert('files', { name: 'new.bam' });

  const newMessages = client.messages.slice(countAfterSubscribe);
  expect(newMessages).toContainEqual(
    expect.objectContaining({
      type: 'added',
      collection: 'files',
    }),
  );
});
```

Run it. It fails because `handleMessage` doesn't watch for changes after subscribing. That's Red.

**What's happening in this test:**

1. The Null Mongo is seeded with empty `find` results (no existing documents)
2. The client subscribes and gets the initial load (just a `ready` message, no docs)
3. We record how many messages the client has _after_ the subscribe
4. We insert a new document into the Null Mongo
5. The Null Mongo's `insert()` internally emits a `ChangeEvent` via its EventEmitter
6. We check that the client received a new `added` message for the inserted document

The key insight: `MongoWrapper.createNull()` already emits change events on insert. You just need Publications to be listening.

### Step 2: Write the GREEN code

This is where you'll need to add change watching to MongoWrapper. The approach:

1. Add a way for Publications to register a callback that fires when documents change in a collection
2. In `handleSubscribe`, after sending initial docs, start watching for changes
3. When a change event fires, send the appropriate message to the subscribed client

You'll likely need to:

- Add `watchChanges(collection, callback)` to `MongoWrapper` (or a similar mechanism)
- In the Null version, wire the callback to `this.emitter.on(collection, callback)`
- In Publications, call `watchChanges` during subscribe and forward events as `added`/`changed`/`removed` messages

The change event from Mongo already has the shape you need: `{ type: 'insert', collection, id, fields }`. Map `type: 'insert'` to `type: 'added'`, and you're done.

### Step 3: Refactor

Extract a function that maps `ChangeEvent` to `DataMsg`:

```
ChangeEvent { type: 'insert', collection, id, fields }
   → DataMsg { type: 'added', collection, id, fields }

ChangeEvent { type: 'update', collection, id, fields }
   → DataMsg { type: 'changed', collection, id, fields }

ChangeEvent { type: 'remove', collection, id }
   → DataMsg { type: 'removed', collection, id }
```

This mapping function will be reused whenever you handle different change types.

Tests should still pass after refactoring.

## File structure when you're done

```
server/
  logic/
    publications.ts          (updated, handles live changes)
  infrastructure/
    mongo.ts                 (updated, watchChanges added)

tests/
  logic/
    publications.test.ts     (updated, new test added)
```

## Definition of done

- [ ] Live change test passes (`npm test`)
- [ ] Inserting a document after subscribe sends an `added` message to the client
- [ ] `MongoWrapper` has a way to watch for changes with a callback
- [ ] Change event to message mapping is extracted into a helper
- [ ] All previous tests still pass (error, initial docs)
- [ ] No lint errors (`npm run lint`)

## Things to watch out for

- **The Null Mongo emits change events synchronously.** When you call `mongo.insert(...)`, the StubbedMongoClient emits the change event immediately via `this.emitter.emit()`. So by the time `insert()` resolves, the event has already fired. This makes testing straightforward but might surprise you if you expect async behaviour.
- **Don't break `trackChanges`.** If you add `watchChanges`, make sure `trackChanges` still works for tests that need it. They can coexist because `trackChanges` creates an OutputTracker that listens to the same EventEmitter.
- **Keep the real MongoWrapper in mind.** Whatever API you add to the Null version, the real version will eventually need to implement it too (using MongoDB change streams). Keep the API simple. A callback function is clean and maps naturally to both implementations.
- **Change events have `type: 'insert'` but messages have `type: 'added'`.** Don't confuse the two. The ChangeEvent uses MongoDB terminology (`insert`/`update`/`remove`), the protocol uses DDP terminology (`added`/`changed`/`removed`). Your mapping function handles this translation.
- **You're only testing `insert` in this story.** Update and remove will follow the same pattern. Don't overengineer the solution for all three cases yet, but do make the mapping function easy to extend.
