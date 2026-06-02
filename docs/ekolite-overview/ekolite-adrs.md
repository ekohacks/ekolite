# ekolite -- Architecture Decision Records

Start with [ekolite-overview.md](ekolite-overview.md) for the big picture.

---

## ADR-001: Replace Meteor with a Custom Lightweight Stack

**Decision:** Build ekolite, a ~820-line replacement using Fastify, MongoDB driver, WebSocket, and Vite.
**Why:** Meteor installs 69 packages (most unused), has slow rebuilds, and locks us into its ecosystem. Our app only uploads BAM files, runs a Python script, and displays charts -- we don't need accounts, sessions, or optimistic UI.
**Backlog impact:**

- All 7 epics exist because of this decision.
- Risk mitigated by keeping the framework small, fully typed, and test-driven.

---

## ADR-002: Fastify as HTTP Server (Not Express)

**Decision:** Use Fastify for its speed, first-class plugin architecture, built-in validation, and official WebSocket/multipart plugins.
**Why:** We need an HTTP server for the client app and file uploads. Fastify is 2-3x faster than Express, has encapsulated plugins instead of sequential middleware, and ships with first-class TypeScript support.
**Backlog impact:**

- Epic 1 (Story 1.A) sets up Fastify; Epic 2 (Story 2.A) uses @fastify/websocket; Epic 5 (Story 5.C) uses @fastify/multipart.

---

## ADR-003: Mini-DDP Instead of Full DDP

**Decision:** Implement Mini-DDP with 6 message types instead of the full ~15-type DDP protocol.
**Why:** Our app only uses subscribe/unsubscribe, method/result/error, and added/changed/removed/ready. We don't need the connect handshake, ping/pong keepalive, session IDs, or reconnect replay.
**Backlog impact:**

- Story 0.B builds the WebSocket wrapper.
- Stories 3.A.1-3.A.4 implement pub/sub; Stories 4.B.1-4.B.2 implement RPC.

---

## ADR-004: ReactiveStore Instead of Minimongo

**Decision:** Replace Minimongo with a `Map<string, T>` that responds to added/changed/removed messages and emits a 'change' event.
**Why:** Our client code does exactly one thing: `UserFiles.find({})` -- get all files with no filter or sort. Minimongo's full MongoDB query API is thousands of lines we don't need. ReactiveStore is ~90 lines.
**Backlog impact:**

- Stories 3.B.1-3.B.3 build the ReactiveStore.

---

## ADR-005: MongoDB Change Streams Instead of Oplog Tailing

**Decision:** Use MongoDB change streams to power pub/sub instead of tailing the raw oplog.
**Why:** Change streams are a documented, supported API (MongoDB 3.6+) that works with the standard driver. Oplog tailing requires Meteor-specific parsing and replica set configuration we don't need to own.
**Backlog impact:**

- Story 0.A.2 implements change stream support in MongoWrapper.
- Story 3.A.3 wires it to Publications.

---

## ADR-006: @fastify/multipart Instead of ostrio:files

**Decision:** Use standard HTTP multipart uploads via @fastify/multipart with XHR progress events on the client.
**Why:** ostrio:files adds DDP chunking, resumable uploads, and its own FilesCollection abstraction -- complexity we don't need for small-to-medium BAM files. Standard HTTP upload works with any client (curl, Postman, not just our app).
**Backlog impact:**

- Story 0.C builds FileStorage.
- Stories 5.A-5.D build the upload pipeline; Stories 5.C.1-5.C.2 build the Fastify route.

---

## ADR-007: Vite Instead of Meteor's Build System

**Decision:** Use Vite for client builds, tsx for dev server, and tsc for type checking only.
**Why:** Meteor's custom bundler transpiles 69 packages via Babel with seconds-long rebuilds and full-page reloads. Vite uses esbuild (100x faster than Babel) and provides true HMR -- sub-100ms updates without page reload.
**Backlog impact:**

- Story 1.B sets up Vite config.
- Story 1.A.1 serves the Vite output.

---

## ADR-008: Testing Without Mocks (Nullable Pattern)

**Decision:** Use James Shore's Nullable pattern -- every infrastructure wrapper has `create()` (real) and `createNull()` (in-memory, same interface), with parity tests ensuring identical behavior.
**Why:** Traditional mocks drift from reality, spy-based assertions break on refactors, and mock setup is verbose. Nullable infrastructure gives fast, reliable tests that catch real bugs and survive refactoring. Only vitest needed -- no mock libraries.
**Backlog impact:**

- All of Smoke Test 0 (Stories 0.A-0.D) builds wrappers with Nullables.
- Every subsequent story uses them. Training: see `ekolite-tdd-training.md` Section 2.

---

## ADR-009: A-Frame Architecture (Logic / Infrastructure Separation)

**Decision:** Separate infrastructure wrappers (external system access) from logic classes (constructor injection), wired together by an Application layer (`App`).
**Why:** If logic classes directly import infrastructure they can't be tested without the real database. With A-Frame, `App.create()` wires real wrappers for production and `App.createNull()` wires Null wrappers for tests. Logic classes never know which kind they received.
**Backlog impact:**

- Directory structure follows this: `server/infrastructure/`, `server/logic/`.
- Story 7.B wires it all in `App`.

---

## ADR-010: TypeScript for the Full Stack

**Decision:** Write ekolite in TypeScript with shared types in `shared/types.ts` used by both server and client.
**Why:** Catch errors at compile time, self-documenting APIs, full IDE support.
**Backlog impact:**

- All code. `tsc --noEmit` checks types; Vite and tsx strip types without checking for fast dev.

---

## ADR-011: Build the Framework (Don't Buy)

**Decision:** Build ekolite ourselves rather than adopting tRPC, Convex, Socket.IO, or Supabase Realtime.
**Why:** ekolite serves a dual purpose: a lightweight biotech real-time stack for genomic data apps, and the teaching platform for the ekohacks coding dojo and bootcamp. Building it teaches Testing Without Mocks, TDD, XP practices, WebSocket protocols, and how to build a framework from first principles.
**Backlog impact:**

- The building process is the product -- smoke tests, TDD training, and worked examples are bootcamp material.
- ~820 lines is a feature: small enough for a bootcamp student to read and understand the entire framework.

---

## ADR Summary -> Backlog Impact

| ADR | Key Decision          | Primary Backlog Impact                                             |
| :-: | --------------------- | ------------------------------------------------------------------ |
| 001 | Replace Meteor        | All epics                                                          |
| 002 | Fastify               | Epic 1 (1.A), Epic 2 (2.A), Epic 5 (5.C)                           |
| 003 | Mini-DDP              | Story 0.B, Epic 3 (3.A), Epic 4 (4.B)                              |
| 004 | ReactiveStore         | Epic 3 (3.B)                                                       |
| 005 | Change streams        | Story 0.A.2, Epic 3 (3.A.3)                                        |
| 006 | @fastify/multipart    | Story 0.C, Epic 5 (5.A-5.D)                                        |
| 007 | Vite                  | Epic 1 (1.B)                                                       |
| 008 | Testing Without Mocks | All of Smoke Test 0, all test code                                 |
| 009 | A-Frame architecture  | Directory structure, Story 7.B                                     |
| 010 | TypeScript            | All code                                                           |
| 011 | Build don't buy       | All -- the framework is the ekohacks product + bootcamp curriculum |
