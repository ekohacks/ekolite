# Story 3.A.4: Unsubscribe Stops Updates

## What this story is about

In Story 3.A.3 you wired up live changes so subscribed clients receive new documents as they're inserted. But what happens when a client unsubscribes? They should stop receiving updates.

This story handles the `unsubscribe` message. When a client unsubscribes from a publication, Publications should:

1. Stop forwarding change events for that subscription
2. Clean up any watchers or listeners
3. Not leak memory

Without this, unsubscribed clients would keep receiving messages they no longer care about, and the server would accumulate dead watchers for every subscription that was ever opened.

## What already exists (read these files first)

| File                               | What it does                                            | Why you need to read it            |
| ---------------------------------- | ------------------------------------------------------- | ---------------------------------- |
| `server/logic/publications.ts`     | Your Publications class with subscribe + live changes   | You're adding unsubscribe handling |
| `tests/logic/publications.test.ts` | Your existing tests (error, initial docs, live changes) | You're adding new tests here       |
| `shared/protocol.ts`               | `UnsubscribeMsg`: `{ type: 'unsubscribe', id: string }` | So you know the message shape      |

## What you need to build

Handle `type: 'unsubscribe'` in `handleMessage()`:

1. Look up the subscription by its ID
2. Remove the client from the subscription tracking
3. Clean up the change watcher for that subscription (whatever mechanism you used in 3.A.3)
4. After unsubscribe, inserting documents should NOT send messages to that client

## How to approach this (TDD)

### Step 1: Write the failing test

Add a new test to `tests/logic/publications.test.ts`:

```typescript
it('stops sending updates after unsubscribe', async () => {
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

  await pubs.handleMessage(client.id, {
    type: 'unsubscribe',
    id: 'sub1',
  });

  const countAfterUnsub = client.messages.length;

  await mongo.insert('files', { name: 'should-not-appear.bam' });

  const newMessages = client.messages.slice(countAfterUnsub);
  expect(newMessages).toHaveLength(0);
});
```

Run it. It fails because `handleMessage` doesn't handle `unsubscribe` yet, so the change watcher from the subscribe is still active and the insert sends a message. That's Red.

**What's happening in this test:**

1. Client subscribes to `files.all` (this sets up a change watcher from Story 3.A.3)
2. Client unsubscribes from `sub1`
3. We record the message count after unsubscribing
4. A new document is inserted into Mongo (triggers a change event)
5. We assert that NO new messages were sent to the client

The critical thing being tested: the change watcher must be cleaned up when the client unsubscribes. If it's still active, the insert will trigger an `added` message and the test fails.

### Step 2: Write the GREEN code

In `handleMessage`, add handling for `type: 'unsubscribe'`:

1. You need to track active subscriptions somewhere (a Map of subscription ID to cleanup function, or subscription ID to subscription metadata)
2. When `subscribe` sets up a change watcher (from Story 3.A.3), store a way to clean it up (e.g. store the cleanup function, or store enough state to unregister the listener)
3. When `unsubscribe` comes in, call the cleanup function and remove the subscription from tracking

This might require refactoring how you set up watchers in `handleSubscribe`. If you stored the watcher as a return value from `watchChanges`, you might need `unwatchChanges` or have `watchChanges` return a cleanup function. Choose whatever approach keeps it simple.

### Step 3: Refactor

Verify there are no memory leaks:

- After unsubscribing, there should be no references to the old subscription
- The change watcher callback should not fire for unsubscribed clients
- If a client subscribes and unsubscribes 100 times, the server shouldn't accumulate 100 dead watchers

Write a test that confirms repeated subscribe/unsubscribe doesn't leak:

```typescript
it('does not leak watchers on repeated subscribe/unsubscribe', async () => {
  const mongo = MongoWrapper.createNull({
    find: [[], [], []],
  });
  const ws = WebSocketWrapper.createNull();
  const client = ws.simulateConnection();
  const pubs = new Publications(mongo, ws);

  pubs.define('files.all', () => ({ collection: 'files', query: {} }));

  for (let i = 0; i < 3; i++) {
    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: `sub${i}`,
      name: 'files.all',
    });
    await pubs.handleMessage(client.id, {
      type: 'unsubscribe',
      id: `sub${i}`,
    });
  }

  const countAfterAll = client.messages.length;

  await mongo.insert('files', { name: 'leaked.bam' });

  const newMessages = client.messages.slice(countAfterAll);
  expect(newMessages).toHaveLength(0);
});
```

This test subscribes and unsubscribes 3 times. If any of those watchers leaked, the insert would send a message. It should send nothing.

If this already passes with your GREEN code, great. If not, fix the leak.

## File structure when you're done

```
server/
  logic/
    publications.ts          (updated, handles unsubscribe)

tests/
  logic/
    publications.test.ts     (updated, new tests added)
```

## Definition of done

- [ ] Unsubscribe test passes (`npm test`)
- [ ] Memory leak test passes
- [ ] After unsubscribe, inserting documents sends no messages to the client
- [ ] Change watchers are properly cleaned up on unsubscribe
- [ ] All previous tests still pass (error, initial docs, live changes)
- [ ] No lint errors (`npm run lint`)

## Things to watch out for

- **The cleanup mechanism depends on what you built in 3.A.3.** If `watchChanges` returns a cleanup function (like `() => void`), store it and call it on unsubscribe. If you used `emitter.on()`, you need `emitter.off()` (which means your EventEmitter might need an `off` method, check if it has one). Choose the approach that keeps things clean.
- **Track subscriptions per client.** A client might have multiple active subscriptions. Use a key like `${clientId}:${subId}` or a nested Map. Don't assume one subscription per client.
- **What if a client unsubscribes from something they never subscribed to?** You could silently ignore it (simplest) or send an error. The test doesn't require error handling for this case, so ignoring is fine for now.
- **The EventEmitter in `output_tracker.ts` doesn't have `off()`.** If you need to remove listeners, you'll need to either add `off()` to the EventEmitter or use a different cleanup strategy (e.g. a flag that the callback checks before acting). Look at what approach is simplest for your implementation.

## What you've built at the end of Story 3.A

After completing all four stories (3.A.1 through 3.A.4), you have a fully functional server side publication system:

```
Publications
  ├── define(name, queryFn)           — register a publication
  ├── handleMessage(clientId, msg)    — route subscribe/unsubscribe
  │   ├── subscribe
  │   │   ├── error if unknown name
  │   │   ├── send initial docs (added + ready)
  │   │   └── start watching for live changes
  │   └── unsubscribe
  │       ├── stop watching for changes
  │       └── clean up subscription tracking
  └── internal
      ├── change event → message mapping
      ├── toAddedMsg / toReadyMsg helpers
      └── subscription tracking (per client, per sub ID)
```

Next up: Story 3.B builds the client side `ReactiveStore` that receives these messages and keeps a local copy of the data.
