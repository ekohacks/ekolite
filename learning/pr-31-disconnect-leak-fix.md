# PR 31 fix summary: disconnect leak, mid emit splice, loose change event guard

Story 3.A.4 (`EKO-229`) shipped `unsubscribe stops updates` in PR 31. Three things were still loose afterwards. This file is the running summary of how they got fixed and what the assertions actually pin.

## Branch

`EKO-229/3a4-unsubscribe-stops-updates`. Two commits on top of what PR 31 originally opened:

- `542f4d5` test: add unit tests for EventEmitter, isChangeEvent utility, and MongoDB watcher behaviour
- `ecd5d8a` feat: add disconnection tracking and client cleanup logic across WebSocket and publication layers

## What was loose

1. **Disconnect leak.** The original PR cleaned up watchers when a client sent `unsubscribe`. It did nothing when a client just closed the socket. In production most clients close tabs without sending `unsubscribe`, so the watcher stayed registered on the mongo emitter and `Publications` kept calling `ws.send` for a clientId that was no longer in the map. `send` no-ops on a missing client, so the only test we had passed silently.
2. **Mid emit splice.** `EventEmitter.emit` walked the live handlers array with `for (const h of handlers)` while `EventEmitter.off` called `Array.prototype.splice` on the same array. A handler that called `off` mid emit shifted indices under the loop and the next handler was skipped. Cleanup paths call `off`. Disconnect teardown calls cleanups in a loop. Only takes one nested emit to start eating handlers silently.
3. **`isChangeEvent` was looser than the union.** Guard only checked `type`. The `ChangeEvent` union promised `fields` on insert/update. A malformed event with `type: 'insert'` and no `fields` passed the guard, and `addedMessage(collection, change.fields)` then read `undefined` behind a type that said otherwise.

## What we changed

### 1. Listener count seam on `EventEmitter`

`server/infrastructure/outputTracker.ts`

```ts
listenerCount(eventType: string): number {
  return this.handlers.get(eventType)?.length ?? 0;
}
```

Tests can now ask "how many handlers are wired to this event right now". This is the seam everything else hangs on.

### 2. Watcher count on `MongoWrapper` (null only)

`server/infrastructure/mongo.ts`

```ts
watcherCount(collection: string): number {
  return this.client.watcherCount(collection);
}
```

`StubbedMongo.watcherCount` returns `this.emitter.listenerCount(collection)`. `RealMongo.watcherCount` throws `'watcherCount is only available on null instances'`, matching the existing register for `trackChanges`.

### 3. Snapshot iteration in `EventEmitter.emit`

```ts
for (const handler of [...handlers]) {
  handler(data);
}
```

One spread. Iterates a copy. Any `off` triggered during the walk mutates the original, not the copy, so the current emit completes cleanly and removals take effect on the next emit.

### 4. `onDisconnect` callback API on `WebSocketWrapper`

```ts
onDisconnect(cb: (clientId: string) => void): () => void
```

Returns a cleanup function. Same shape as `mongo.watchChanges`. Both `RealWebSocket` and `FastifyWebSocket` now hold an internal `EventEmitter` and emit `DISCONNECTION_EVENT` from inside their `socket.on('close', ...)` handlers. `StubbedWebSocket` already emitted that event, just exposes it through the new API.

### 5. `Publications` wires the disconnect teardown in its constructor

```ts
constructor(mongo: MongoWrapper, ws: WebSocketWrapper) {
  this.mongo = mongo;
  this.ws = ws;
  this.ws.onDisconnect((clientId) => {
    this.tearDownClient(clientId);
  });
}

private tearDownClient(clientId: string): void {
  const clientSubs = this.subscriptions.get(clientId);
  if (!clientSubs) return;
  for (const cleanup of clientSubs.values()) {
    cleanup();
  }
  this.subscriptions.delete(clientId);
}
```

The map was already keyed by `clientId` from the original PR, so the wire up is small.

### 6. Re-subscribe ordering

In `Publications.handleMessage`, the dispose for an existing subscription with the same `id` now runs _before_ the new `watchChanges` call, not after. No window where two watchers exist for the same sub id.

### 7. `isChangeEvent` checks the shape, not just the type

`shared/types.ts`

```ts
export function isChangeEvent(data: unknown): data is ChangeEvent {
  if (typeof data !== 'object' || data === null) return false;
  if (!('type' in data) || !('collection' in data) || !('id' in data)) return false;
  if (typeof (data as { collection: unknown }).collection !== 'string') return false;
  if (typeof (data as { id: unknown }).id !== 'string') return false;

  const type = (data as { type: unknown }).type;
  if (type === 'insert' || type === 'update') {
    if (!('fields' in data)) return false;
    const fields = (data as { fields: unknown }).fields;
    return typeof fields === 'object' && fields !== null && !Array.isArray(fields);
  }
  return type === 'remove';
}
```

Guard now matches what the union promises.

## How we know the fix is real, not just green

The original PR's leak assertion was `expect(newMessages).toHaveLength(0)`. As the second pass review pointed out, `send` no-ops on a disconnected client, so that assertion would pass whether the watcher was torn down or just orphaned. The new assertion is `expect(mongo.watcherCount('files')).toBe(0)`. That fails for "watcher still alive but its outputs vanish into a closed socket".

Five mutations, run against the new production code, each caught by a specific test:

| Mutation                                                             | Caught by                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `EventEmitter.listenerCount` returns 0 always                        | three direct unit tests plus five dependents (`watcherCount`, leak tests) |
| `tearDownClient` only deletes the map without calling cleanups       | `tears down only the disconnecting client and leaves others intact`       |
| `tearDownClient` clears every client, not just the disconnecting one | same test (clientB's watcher would also vanish)                           |
| `EventEmitter.emit` reverts to live iteration                        | `iterates over a snapshot so handlers can off themselves mid emit`        |
| `isChangeEvent` drops the `fields` check                             | `rejects insert/update without fields`                                    |
| `Publications` constructor skips the `onDisconnect` registration     | both disconnect leak tests                                                |

Each failure read like `expected 0 to be 1`, not `method missing`. The assertions pin behaviour.

## Tests added

- `tests/shared/types.test.ts` (new) — 9 tests on `isChangeEvent` strictness
- `tests/infrastructure/outputTracker.test.ts` (new) — 5 tests on `listenerCount` and `emit` snapshot iteration
- `tests/infrastructure/mongo.test.ts` — 3 new tests on `watcherCount`
- `tests/logic/publications.test.ts` — 4 new tests covering disconnect teardown, multi client isolation, and per client keying so two clients can pick the same sub id

Total run: 82 tests passing locally on this branch. Typecheck and lint clean.

## Still open

- **The blog post** at `learning/red-for-the-right-reason.md` is a draft, not posted. It frames the mutation testing practice the fix used.
- **The third pass review comment** has not been posted to the PR. Waiting on Ebuka to come back with his own thinking before drafting it. The shape will be: the disconnect leak is the dominant case, here are the assertions that pin it, here are the mutations that catch each piece, anything else worth raising.
