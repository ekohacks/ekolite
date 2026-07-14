# EkoLite, Architecture Decision Records

Start with [ekolite-overview.md](ekolite-overview.md) for the big picture.

Each record states what was decided and why. They are kept as written, so a decision that later moved is corrected in place rather than quietly deleted.

---

## ADR-001: Replace Meteor With a Lightweight Stack

**Decision:** Replace Meteor with EkoLite: roughly 3,500 lines of TypeScript over Fastify, the MongoDB driver, WebSocket and Vite.

**Why:** The application this was built for uploads genomic data files, runs an analysis script over them and displays the results. It needs live data and remote calls. It does not need accounts, sessions, optimistic UI or a client-side query engine. Meteor ships all of that, installs 69 packages to do it, takes its own build system with it, and rebuilds slowly. The cost of owning a small stack turned out to be lower than the cost of carrying a large one.

---

## ADR-002: Fastify as HTTP Server, Not Express

**Decision:** Use Fastify for its speed, plugin architecture, built-in validation and official WebSocket and multipart plugins.

**Why:** The framework needs an HTTP server for the client application and for file uploads. Fastify is significantly faster than Express, has encapsulated plugins rather than sequential middleware, and ships first-class TypeScript support.

---

## ADR-003: Mini DDP Instead of Full DDP

**Decision:** Implement Mini DDP: eleven message types against roughly fifteen in full DDP, and none of the session machinery.

`subscribe`, `unsubscribe`, `method` and `ping` go from client to server. `ready`, `added`, `changed`, `removed`, `result`, `error` and `pong` come back.

**Why:** The saving is not really in the message count, it is in what the protocol refuses to do. There is no connect handshake, no session identity, no merge box reconciling overlapping subscriptions, and no reconnect replay. A client that loses its socket re-subscribes rather than replaying a session log.

**Later correction:** This decision originally dropped `ping` and `pong` too, on the grounds that the WebSocket library keeps the connection alive by itself. That turned out to be wrong. A TCP connection can be dead while both ends still believe it is open, and the library's own keepalive does not tell the application. The heartbeat added `ping` and `pong` at the application level so a client can detect a silently dead socket and close it. The two message types are in the protocol because that problem is real.

---

## ADR-004: ReactiveStore Instead of a Client-Side Database

**Decision:** Give the client a `ReactiveStore`: a `Map<string, T>` that responds to `added`, `changed` and `removed` messages and emits a change event.

**Why:** The client asks one question: give me the documents in this collection. A full query engine mirrored into the browser is thousands of lines to answer a question nobody asked. The store is about ninety lines. Anything that needs filtering or sorting can do it on the server, where the data already lives.

---

## ADR-005: MongoDB Change Streams Instead of Oplog Tailing

**Decision:** Use MongoDB change streams to power pub/sub rather than tailing the raw oplog.

**Why:** Change streams are a documented, supported API that works with the standard driver. Oplog tailing, which is how Meteor did it, means parsing an internal log and owning replica set configuration that the application otherwise has no reason to care about.

---

## ADR-006: Standard HTTP Multipart Uploads

**Decision:** Upload files with standard HTTP multipart through `@fastify/multipart`, with progress reported from the browser's own upload events.

**Why:** Uploading over the WebSocket protocol means chunking, resumption and a bespoke file collection abstraction. Standard HTTP upload is simpler, and it works from anything that speaks HTTP, including curl and Postman, not only from the application's own client.

---

## ADR-007: Vite Instead of a Bespoke Bundler

**Decision:** Use Vite for client builds, tsx for the dev server, and tsc for type checking only.

**Why:** Meteor's custom bundler transpiled its whole package set through Babel, took seconds to rebuild, and reloaded the entire page on a change. It was the single biggest drag on the development loop. Vite uses esbuild, which is orders of magnitude faster than Babel, and gives true hot module replacement rather than reloading the whole page. Type checking is a separate step on purpose: the dev loop strips types without checking them, so it stays fast, and `tsc --noEmit` is the gate.

---

## ADR-008: Testing Without Mocks, the Nullable Pattern

**Decision:** Use James Shore's Nullable pattern. Every infrastructure wrapper has `create()` for the real thing and `createNull()` for an in-memory one behind the same interface, with parity tests holding the two to identical behaviour.

**Why:** Mocks drift from reality, spy-based assertions break whenever the code is refactored, and mock setup buries the point of the test. Nullable infrastructure gives fast tests that exercise real logic against substitutable edges, survive refactoring, and need no mocking library. There is vitest, and nothing else.

---

## ADR-009: A-Frame Architecture, Logic Separated From Infrastructure

**Decision:** Separate infrastructure wrappers, which reach outside the process, from logic classes, which receive their collaborators through the constructor. An application layer, `App`, wires the two together.

**Why:** Logic that imports its own infrastructure cannot be tested without the real database. With the wiring pulled out, `App.create()` assembles real wrappers for production and `App.createNull()` assembles nulled ones for tests, and the logic never learns which kind it was handed. The assembly that boots in production is the assembly the tests drive.

---

## ADR-010: TypeScript Everywhere

**Decision:** Write EkoLite in TypeScript, with the wire protocol types in `shared/protocol.ts` used by both server and client.

**Why:** The protocol is the contract between the two halves. If it is typed in one place and both ends import it, a message that changes shape breaks the build rather than a user's session.

---

## ADR-011: Build the Framework Rather Than Adopt One

**Decision:** Build EkoLite rather than assemble the same capability from tRPC, Convex, Socket.IO or Supabase Realtime.

**Why:** The requirement is narrow and long-lived: live data from MongoDB, remote calls, file uploads, and nothing else. An adopted stack brings its own model of all three, and the parts that do not fit are the parts you end up fighting for years. A framework small enough to read end to end is a framework you can change when the requirement changes. That is the trade being made: more code owned, in exchange for owning it.
