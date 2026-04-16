# The Settled Guard: What Our Tests Can and Cannot Prove

> "The teacher is no longer merely the one who teaches, but one who is taught in dialogue with the students." Paulo Freire

At EkoHacks we don't just write code that passes tests. We understand what those tests actually guarantee and, just as importantly, where the guarantees stop. This session walks through a real pattern from our codebase and asks you to think critically about the boundary between what tests prove and what design proves.

## What is a race condition?

Two things are supposed to happen one at a time. But they happen at the same time, or in the wrong order, and the result is broken.

Think of it like this. You and your flatmate both check the fridge. Both of you see there's no milk. Both of you go to the shop. Now you've got two cartons and nobody needed two. You both "read" the same state (no milk) and both "wrote" (bought milk) because neither of you knew the other one was already handling it.

In code it works the same way. Two callbacks, two event handlers, two async operations. They both try to do the same thing. If you don't coordinate them, one of them does something it shouldn't.

### Where this shows up in our code

When a WebSocket connects, the runtime can fire two events:

- `onopen` — connection succeeded
- `onerror` — something went wrong

Normally only one fires. But in some runtimes, under certain network conditions, both can fire. That's the race. Two callbacks racing to settle the same promise. Whichever one runs first should win. The other should do nothing.

**Try this thought experiment.** You call `connect()`. The TCP handshake completes. `onopen` fires, the promise resolves, your code carries on. Then a split second later the connection hiccups and `onerror` fires too. What should happen?

Nothing. The connection worked. The promise already resolved. The error handler should see that someone already dealt with it and back off.

That's what the `settled` flag does. First one in sets it to `true`. Second one checks, sees `true`, walks away.

**Question for the pair:** What would happen if there was no `settled` flag and both callbacks ran? Remember that `reject()` on an already resolved promise is silently ignored by the runtime. So the promise itself is fine. But what about any other code inside those callbacks?

## The code

Open `client/clientSocket.ts` and find the `connect()` method on `RealClientSocket`. Read it properly, don't skim. Then come back.

```ts
connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    this.socket = new WebSocket(this.url, this.options);
    this.socket.onopen = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    this.socket.onerror = (err) => {
      if (!settled) {
        settled = true;
        reject(new Error(err.message satisfies string));
      }
    };
  });
}
```

You already know what `settled` does from the closures session. Two functions sharing the same variable so the first one to fire wins.

But now the question is different. Now it's about **testing**.

## What the tests prove

Open `tests/client/clientSocket.integration.test.ts` and find the `ClientSocket connect settles once` describe block. Two tests. Read both.

### Test 1: "ignores onerror after onopen has already resolved"

```ts
it('ignores onerror after onopen has already resolved', async () => {
  webSocketServer = WebSocketWrapper.createRawWs({ port: PORT });
  await webSocketServer.start();
  const client = ClientSocket.create(`ws://localhost:${String(PORT)}`);

  await client.connect();
  expect(client.isConnected).toBe(true);

  await client.close();
});
```

**Stop and think:**

- This test starts a server, connects, checks it worked, then closes. What is it actually testing?
- Does it ever trigger `onerror`?
- If you removed the `settled` guard entirely, would this test still pass?

**Be honest with yourself.** This test proves the happy path resolves. It proves `onopen` fires and the promise settles. That is all. It does not exercise the race condition. It cannot.

### Test 2: "rejects once when server is not running"

```ts
it('rejects once when server is not running', async () => {
  webSocketServer = WebSocketWrapper.createRawWs({ port: PORT });
  await webSocketServer.start();
  await webSocketServer.close();

  const client = ClientSocket.create(`ws://localhost:${String(PORT)}`);
  await expect(client.connect()).rejects.toThrow();
});
```

**Stop and think:**

- The server starts and then immediately closes. Why?
- When the client tries to connect, what fires: `onopen` or `onerror`?
- If you removed the `settled` guard, would this test still pass?

**Be honest with yourself.** This test proves the sad path rejects. `onerror` fires, the promise rejects, the caller gets an error. It does not test what happens when both paths fire.

## How we know the tests aren't lying

When we wrote these tests, they went green immediately. That's suspicious. A test that was never red could be testing nothing.

So we broke the code on purpose. We commented out `resolve()` inside `onopen` and ran the suite.

```
❯ tests/client/clientSocket.integration.test.ts (5 tests | 3 failed) 35052ms
  × ClientSocket (real) > connects to a real server 5020ms
    → Test timed out in 5000ms.
  × ClientSocket connect settles once > ignores onerror after onopen has already resolved 15010ms
    → Test timed out in 5000ms.
  ✓ ClientSocket connect settles once > rejects once when server is not running 7ms
  ✓ ClientSocket auth > rejects connections without an auth token 5ms
  × ClientSocket auth > connects when a valid auth header is provided 15009ms
    → Test timed out in 5000ms.
```

Three tests hung and timed out. `await client.connect()` never returned because `resolve()` never got called. The promise just sat there. No error, no crash, just silence. The test runner waited 5 seconds and went red.

That's what these tests guard against. If someone removes or breaks `resolve()`, or messes up the state that `isConnected` depends on, these tests catch it immediately.

**Question for the pair:** Look at the output above. Two tests still passed. Why did those two not care that `resolve()` was missing?

## The gap

Here is the scenario the `settled` guard actually protects against:

```
1. Client calls connect()
2. WebSocket starts the TCP handshake
3. onopen fires → promise resolves → caller continues
4. Something goes wrong on the now-open connection
5. onerror fires → tries to reject the same promise
```

Step 5 is the problem. The promise already resolved in step 3. Calling `reject()` on an already-resolved promise is silently ignored by the runtime. So without the guard it wouldn't crash. But.

**Question for the pair:** If `reject()` on a settled promise is silently ignored, why do we need the `settled` guard at all? What is the guard actually preventing?

Think about it before reading on.

## The real reason

The guard is not protecting `resolve` and `reject`. The JavaScript runtime already handles double settlement. You cannot settle a promise twice.

The guard is protecting **everything else inside the callbacks**.

Imagine the code grows. Someone adds logging, state changes, or cleanup inside `onerror`:

```ts
this.socket.onerror = (err) => {
  if (!settled) {
    settled = true;
    this.connectionAttempts++;
    this.lastError = err.message;
    reject(new Error(err.message));
  }
};
```

Without the guard, those side effects run even when the connection already succeeded. `connectionAttempts` gets incremented on a successful connection. `lastError` gets set even though there was no real error. State gets corrupted silently.

The `settled` flag is not about the promise. It is about making the intent explicit: **once one path wins, the other path does nothing. Full stop.** Not just "doesn't settle the promise" but "doesn't execute at all."

**Question for the pair:** Can you think of a scenario in our codebase where running `onerror` side effects after a successful `onopen` would cause a real bug? Look at how we use `isConnected`. What would happen if error handling code set `isConnected = false` after a successful connection?

## Why we cannot test this with a real WebSocket

To test the race condition properly, we would need to:

1. Start a real server
2. Connect a real client
3. Have `onopen` fire
4. Then force `onerror` to fire on the same socket

Step 4 is the problem. We do not control when the runtime fires WebSocket events. We cannot tell a real WebSocket "fire onerror now." Those events come from the operating system's network stack, not from our code.

**Question for the pair:** Could we test this with the null/stubbed version? What would we need to add to `StubbedClientSocket` to simulate both events firing? Would that test be testing our code or testing our simulation?

## What the tests do guarantee

| Test                                                | What it proves                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| "ignores onerror after onopen has already resolved" | The resolve path works. `onopen` fires, promise resolves, `isConnected` is true. If someone breaks the happy path, this catches it. |
| "rejects once when server is not running"           | The reject path works. `onerror` fires, promise rejects with an error. If someone breaks error handling, this catches it.           |

Together they prove that **both branches of the settled guard work independently**. They do not prove the guard works when both branches race. That is a design guarantee, not a test guarantee.

## The lesson

Some code is correct by design, not by test. The `settled` guard is a pattern. It works because of how closures and shared mutable state behave, and you proved that to yourselves in the closures session. The tests verify each path in isolation. The design ensures they don't interfere.

**This is not a failure of testing.** This is a boundary. Know which guarantees come from your tests and which come from your design. Don't confuse the two. Don't claim a test covers something it doesn't.

When you write a `settled` guard in future code, and you will, you now know:

1. Write a test for the resolve path
2. Write a test for the reject path
3. Know that the guard itself is a design decision backed by how closures work
4. Document why the guard exists so the next person doesn't remove it thinking it's dead code

## Your turn

Look at `RealWebSocketServer.start()` in `server/infrastructure/websocket.ts`. It has a `new Promise` with a resolve inside a callback.

- Does it have a reject path?
- What happens if the server fails to start?
- Should it have a settled guard? Why or why not?

> At EkoHacks we don't just write tests that pass. We understand what passing means.
