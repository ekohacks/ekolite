# The off switch we didn't fit: revisiting Nullable Infrastructure

### What started this

A coverage run last week showed something that didn't sit right. `server/infrastructure/websocket.ts` reads 39% statements, 25% branches. `client/clientSocket.ts` reads 57%, 31%. Most of the uncovered lines lived inside the `Real*` classes, the ones that wrap the real third party I/O.

The first explanation that came to mind was reassuring and wrong: "the unit suite uses `createNull()`, so the Real classes only run under `npm run test:integration`. Coverage looks split because the runs are split."

We looked more carefully.

### What our wrappers actually were

`ClientSocketWrapper` holds a `ClientSocketInterface`. That interface lists every public method the wrapper exposes: `connect`, `send`, `onMessage`, `trackMessages`. Two classes implement the interface, `RealClientSocket` and `StubbedClientSocket`, and each carries its own full copy of the wrapper's logic. Its own state, its own emitter, its own message parser. The wrapper itself is one line per method, forwarding to whichever implementation is plugged in.

The same shape lives across `MongoWrapper`, `FileStorageWrapper`, `ScriptRunnerWrapper`, and `WebSocketWrapper`. `WebSocketWrapper` actually has three implementations of its interface, `RealWebSocket`, `FastifyWebSocket`, and `StubbedWebSocket`, to handle the various server styles we support.

This isn't Nullable Infrastructure. It's a Facade sitting in front of a Stub Object pattern. The pattern Shore writes about has one class with the logic; the only difference between real and null is what resource the class wraps. What we have is two parallel implementations of every wrapper, with the logic duplicated and kept in sync by hope.

### Why the coverage gap, then

Because the unit suite ran the Stubbed copy of the logic. The integration suite ran the Real copy. Both passed. The numbers showed half coverage on each file because, honestly, half the file was running under each suite. The number wasn't lying. The framing "integration covers it" was the mistake. What integration covers is a parallel implementation of the same surface, which can drift from the Null version without anyone noticing, until production behaves differently than tests.

### Re-reading Shore

The Nullable Infrastructure pattern is in [Testing Without Mocks](https://www.jamesshore.com/v2/projects/nullables/testing-without-mocks). The line that landed for us:

> Production code with an "off switch."

One class. One factory for each mode. The constructor takes the I/O resource. The Real factory passes the real thing (`process`, a real DOM `WebSocket`, the MongoDB driver). The Null factory passes a small "Embedded Stub" that mimics only the methods the wrapper actually calls on that resource. The class never changes.

The Java and C# variant Shore calls "Thin Wrapper" is the same shape with one extra piece: an explicit interface for the I/O resource, and a small adapter class that wraps the third party API to satisfy that interface. TypeScript fits this variant naturally because of `strict` mode and the cost of casting.

### The fix applied to ClientSocket

The refactor for `client/clientSocket.ts` was one PR worth of work, sequenced as four pieces:

1. A `WebSocketLike` interface listing only what the wrapper calls on the underlying socket: `send`, `close`, `readyState`, and the four `on*` handlers. Nothing else from the DOM spec, because the wrapper doesn't use anything else.
2. A `RealWebSocket` adapter that wraps the real DOM `WebSocket` and exposes the `WebSocketLike` shape. This is the only place in the codebase that touches the global `WebSocket` directly. Any browser quirk or spec drift is absorbed here, not in the wrapper.
3. A `NullWebSocket` Embedded Stub in the same file. It implements `WebSocketLike` and mimics the socket lifecycle: `CONNECTING` then `OPEN` on the next microtask, `CLOSED` on `close()`. It has one extra method beyond the interface, `deliver`, that the public `StubbedServer` helper reaches into to fire inbound messages from tests.
4. `ClientSocketWrapper` collapses to one class with all the logic. `RealClientSocket` and `StubbedClientSocket` are gone. Two static factories: `create(url)` instantiates a `RealWebSocket`; `createNull()` instantiates a `NullWebSocket`. Both go through the same constructor and the same code path.

The public API stays identical. `connect`, `close`, `send`, `onMessage`, `trackMessages`, `simulateServer`, `isConnected` all behave the same to consumers. Nothing downstream of the wrapper changed. `ConnectionManager`, `Publications`, the existing tests, all untouched apart from one new test that exercises a path the parallel implementations couldn't.

### Numbers

Before, on the PR #39 branch:

- `client/clientSocket.ts`: 56.89% statements, 31.25% branches, 65.51% functions.

After the refactor, same test suite:

- `client/clientSocket.ts`: 81.44% statements, 75.60% branches, 78.37% functions.

The 19% that remains uncovered is the `RealWebSocket` adapter itself, exactly the place the unit suite shouldn't cover, because the adapter does nothing but pass calls through to the real DOM `WebSocket`. That's what the integration suite is for now, and its job is honest: prove the adapter's pass through holds against a real network. Nothing more, nothing less.

### One test the refactor enabled

The malformed payload contract: when the server sends a non-JSON string over the wire, the wrapper logs and drops it without crashing the inbound listener. Before the refactor, that test couldn't run against the Null path because the Null path didn't parse; it just emitted whatever was passed in. After the refactor, both paths go through the same parser. Five lines of test, a contract pinned forever.

### The four wrappers that come next

`FileStorageWrapper`, `ScriptRunnerWrapper`, `MongoWrapper`, `WebSocketWrapper`. Each takes the same template:

1. Define an `*Like` interface listing only what the wrapper actually calls on the resource.
2. Write a `Real*` adapter (the Thin Wrapper around the third party library).
3. Write a `Null*` Embedded Stub mimicking the resource's lifecycle.
4. Collapse the wrapper to one class with both factories.

Order sets up the pattern on the small files first (FileStorage, ScriptRunner), then the larger ones (Mongo, WebSocket). `WebSocketWrapper` is the biggest payoff. It currently has three parallel implementations of the same interface. After the refactor, one wrapper holds the logic, and Real, Fastify, and Null are three resource adapters.

### The thing worth carrying

When a refactor adds a test double, ask one question: is the double a stand in for the wrapper's _resource_, or for the _wrapper itself_?

If you're writing a parallel implementation of the wrapper's whole interface, you've reached for Mock Object and put it behind a Facade. The two implementations have to be kept in sync by discipline. Coverage will show them as separate concerns. Tests will pass even when the implementations drift.

If you're writing a small thing that only implements the surface the wrapper touches on its resource, you've got Nullable Infrastructure. One logic path. One coverage column. Drift impossible because there's nowhere for it to hide.

The cost of getting it backwards is visible in coverage long after the code shipped, and only if someone reads coverage strictly. Easy to miss. Easy to fix once you see it.
