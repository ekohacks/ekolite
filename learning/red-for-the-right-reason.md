# Red for the Right Reason: Validating That Your Tests Are Actually Testing

> 'Authentic education is not carried on by A for B or by A about B, but rather by A with B.' Paulo Freire

At EkoHacks we do not hand down rules about how to write tests. We show you a moment a green test gave a false sense of safety, a moment a red test misdiagnosed the problem, and one experiment you can run yourself to tell the difference.

## The setup

EkoLite has a tiny Meteor style publication system on the server. A client subscribes to a query, the server sends initial documents, then live changes flow as a Mongo collection mutates. The slice we are looking at is the cleanup half. When a subscription ends, the watcher behind it has to go away. Otherwise the server keeps doing work for clients that are no longer there.

The first pass at this in PR 31 added an `unsubscribe` message type and a cleanup function, then wrote two tests:

```ts
it('stops sending updates after unsubscribe', async () => {
  const mongo = MongoWrapper.createNull({ find: [[]] });
  const ws = WebSocketWrapper.createNull();
  const client = ws.simulateConnection();
  const pubs = new Publications(mongo, ws);

  pubs.define('files.all', () => ({ collection: 'files', query: {} }));

  await pubs.handleMessage(client.id, { type: 'subscribe', id: 'sub1', name: 'files.all' });
  await pubs.handleMessage(client.id, { type: 'unsubscribe', id: 'sub1' });

  const countAfterUnsub = client.messages.length;
  await mongo.insert('files', { name: 'should-not-appear.bam' });

  const newMessages = client.messages.slice(countAfterUnsub);
  expect(newMessages).toHaveLength(0);
});
```

It runs green. The PR ships. The story closes. Done.

## The moment of doubt

Now copy that test and change one line. Instead of sending an `unsubscribe` message, just close the socket:

```ts
await pubs.handleMessage(client.id, { type: 'subscribe', id: 'sub1', name: 'files.all' });

client.close();

const countAfterClose = client.messages.length;
await mongo.insert('files', { name: 'should-not-appear.bam' });

const newMessages = client.messages.slice(countAfterClose);
expect(newMessages).toHaveLength(0);
```

This also runs green. And there is no production code wired up to handle a disconnect. Nothing tears down the watcher when a client closes its tab. The watcher is still alive, still subscribed to Mongo change events, still calling `ws.send` for a client that no longer exists.

So why does the test pass?

Read the production path. Inside `StubbedWebSocket.send`:

```ts
send(clientId: string, message: unknown): void {
  const client = this.clients.get(clientId);
  if (client) {
    client.messages.push(message);
  }
}
```

When the client is gone, `send` quietly does nothing. The watcher is firing, the callback is running, the message is being constructed, and the very last step throws it away. Our assertion `expect(newMessages).toHaveLength(0)` cannot tell the difference between 'the watcher was torn down' and 'the watcher is alive but its outputs are vanishing into a closed socket'.

The original `unsubscribe` test has the same shape. It happens to be testing real behaviour in that case, because the cleanup function is being called. But the assertion does not prove the cleanup is doing what we think. It would still pass if `unsubscribe` simply removed the entry from a tracking map and left the watcher running.

That is a green test that does not earn its green.

## A move you can run on any test

Pick a test that you believe is protecting some behaviour. Open the production code that makes it pass. Break it on purpose. Run the test. If it does not fail, the test is not testing what you think.

We did this with five separate changes on the cleanup work. One of them is the cleanup loop on disconnect. The honest version reads like this:

```ts
private tearDownClient(clientId: string): void {
  const clientSubs = this.subscriptions.get(clientId);
  if (!clientSubs) return;
  for (const cleanup of clientSubs.values()) {
    cleanup();
  }
  this.subscriptions.delete(clientId);
}
```

The lazy version, the one that satisfies a weak assertion, is this:

```ts
private tearDownClient(clientId: string): void {
  this.subscriptions.delete(clientId);
}
```

Map cleared, watchers untouched. With the weak assertion in place, both versions pass. Try this in your own tests next time you finish a feature. Replace the body of one method with `return` or `return 0` or `return null`. If the suite is still green, the missing assertion is louder than the failing one would be.

## The assertion that earns its red

The fix is to find a question whose answer changes when the production behaviour changes. For this story the question is: how many listeners are registered on the Mongo emitter for this collection right now?

That is something the `EventEmitter` can answer if we ask it to:

```ts
listenerCount(eventType: string): number {
  return this.handlers.get(eventType)?.length ?? 0;
}
```

Surface it through the wrapper as `mongo.watcherCount(collection)` and the assertion becomes load bearing:

```ts
it('tears down watchers when a client disconnects without unsubscribing', async () => {
  const mongo = MongoWrapper.createNull({ find: [[]] });
  const ws = WebSocketWrapper.createNull();
  const client = ws.simulateConnection();
  const pubs = new Publications(mongo, ws);

  pubs.define('files.all', () => ({ collection: 'files', query: {} }));
  await pubs.handleMessage(client.id, { type: 'subscribe', id: 'sub1', name: 'files.all' });

  expect(mongo.watcherCount('files')).toBe(1);

  client.close();

  expect(mongo.watcherCount('files')).toBe(0);
});
```

Now run the lazy version of `tearDownClient` again. The map is empty but the watcher is still on the emitter. `watcherCount` returns 1. The test fails. Restore the cleanup loop. The test passes.

Same shape, same setup, different question. The first question was 'did any messages reach a client that no longer exists', which is unanswerable from outside. The second question is 'how many handlers are wired into this event channel', which has one true answer.

## A second mutation: the splice that hides itself

The same move surfaced something stranger one layer down. The `EventEmitter` that backs `watchChanges` has an `emit` method that walks the handler array and calls each one. The companion `off` method removes a handler with `Array.prototype.splice`. If a handler calls `off` while `emit` is still walking, the indices shift under the loop and the next handler is skipped.

The fix is one character of intent and three of code:

```ts
emit(eventType: string, data: unknown): void {
  const handlers = this.handlers.get(eventType) ?? [];
  for (const handler of [...handlers]) {
    handler(data);
  }
}
```

The spread takes a snapshot of the array at the moment `emit` begins. Any `off` triggered during the walk mutates the original, not the snapshot, so the current emit completes cleanly and the removal takes effect on the next one.

It is easy to look at this and feel it is paranoid. It is not. The cleanup function returned by `watchChanges` calls `off`. The disconnect handler we wired into `Publications` calls those cleanups in a loop. It is not a long walk to a path where one cleanup triggers another emit that triggers another cleanup. The cost of the spread is a single array allocation per emit. The cost of getting it wrong is a silent skip that no test will catch unless you ask the right question.

Here is the assertion that asks it:

```ts
it('iterates over a snapshot so handlers can off themselves mid emit', () => {
  const emitter = new EventEmitter();
  const calls: string[] = [];

  const first = (): void => {
    calls.push('first');
    emitter.off('files', second);
  };
  const second = (): void => {
    calls.push('second');
  };
  const third = (): void => {
    calls.push('third');
  };

  emitter.on('files', first);
  emitter.on('files', second);
  emitter.on('files', third);

  emitter.emit('files', { type: 'insert' });

  expect(calls).toEqual(['first', 'second', 'third']);
});
```

Drop the spread, run the test, watch the assertion print `['first', 'third']`. `second` was at index one when the loop started. `first` ran, spliced `second` out, and the loop advanced to index one, which now held `third`. The skipped handler made no noise. No exception, no log, no symptom anywhere except the absent call.

There is a different trade you could make here. Leave `emit` walking the live array and document the constraint that handlers must not call `off` during an emit. Faster on the hot path by a few microseconds, but a sharper edge that future contributors have to know about. The snapshot pays a tiny cost on every emit and the rule disappears. We chose the snapshot for that reason.

## Why this matters in TDD

The TDD rhythm leans on red and green meaning what we think they mean. If green can mean 'nothing is happening because nothing is connected', the safety net has a hole the size of any feature you ship without checking.

The check itself takes about a minute per assertion. Open the file under test. Replace the body of the method the test depends on with the dumbest possible implementation. Run the test. If it stays green, the assertion is not the one you wanted. Choose a different question, write the assertion in those terms, then put the production code back.

We caught the disconnect leak this way. We also caught a malformed `isChangeEvent` guard that accepted insert events with no `fields` field, the mid emit splice you saw above, and a re subscribe path that briefly held two watchers for the same subscription id. Five mutations, five assertions that flipped to red on the right ones, five reasons to trust the suite slightly more than yesterday.

## The reproducible move

When you finish a feature and the tests are green, before you open the PR:

Pick one assertion you care about. Open the production file it covers. Change the body of one method to something obviously wrong. Run only that test. If it passes, the assertion does not earn its green. Find a question whose answer the production behaviour can actually change.

That is the practice. We would love to hear from you about a test you ran this on and what you found. Tell us in the comments or on the EkoHacks channel.
