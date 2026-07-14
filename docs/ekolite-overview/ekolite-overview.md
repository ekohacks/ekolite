# EkoLite — Overview

A small real-time backend framework, around 3,500 lines of TypeScript across server, client and shared. Tested without mocks.

---

## What It Does

EkoLite is a lightweight real-time backend framework. Five standard tools do the whole job:

| Capability     | How                                             |
| -------------- | ----------------------------------------------- |
| HTTP server    | Fastify                                         |
| Real-time data | WebSocket + Mini-DDP (11 message types)         |
| Database       | MongoDB driver + change streams                 |
| Client data    | ReactiveStore (a simple Map that stays in sync) |
| File uploads   | @fastify/multipart                              |
| Build          | Vite (client) + tsx (server)                    |

---

## Architecture

Three layers. Logic never touches external systems directly.

```
        App (wires everything)
       /         |         \
  Publications  Methods  UploadHandler     ← Logic
       \         |         /
  MongoWrapper  WebSocket  FileStorage     ← Infrastructure
       |         |         |
    MongoDB    Fastify    Node fs          ← External systems
```

Every infrastructure wrapper has two factories:

- `create()` — connects to the real system
- `createNull()` — runs in-memory, same interface

This is how we test without mocks. The logic layer doesn't know which one it's talking to.

---

## The Protocol

Client and server talk over WebSocket with 11 message types:

```
Client → Server:         Server → Client:
  subscribe                ready
  unsubscribe              added / changed / removed
  method                   result / error
  ping                     pong
```

Full DDP has ~15 message types. The saving is less in the count than in what is absent: no connect handshake, no session identity, no merge box, no latency compensation.

---

## How We Build It

**Red-Green-Refactor**, every time:

1. **Red** — Write a failing test using `createNull()` infrastructure
2. **Green** — Write the minimum code to make it pass
3. **Refactor** — Improve structure, tests stay green

No `vi.mock()`. No spies. Real code with an off switch.

---

## The Build Plan

8 smoke tests, built in order. Each one proves a piece of the framework works.

```
ST 0  Infrastructure wrappers    → Can we test without real systems?
ST 1  Server + static page       → Fastify + Vite work?
ST 2  WebSocket connection        → Real-time transport works?
ST 3  Pub/sub + reactive store   → Live data updates work?
ST 4  RPC methods                → Server calls work?
ST 5  File upload                → BAM upload works?
ST 6  File validation            → Bad files rejected?
ST 7  End-to-end pipeline        → Full workflow works end-to-end
```

When Smoke Test 7 passes, the framework covers everything a real-time, data-driven app needs.

---

## Deep Dive Docs

Read these when you need detail on a specific topic:

| Doc                                                | What's in it                                       |
| -------------------------------------------------- | -------------------------------------------------- |
| [System design](ekolite-system-design.md)          | How the framework is put together, and why         |
| [Architecture decisions](ekolite-adrs.md)          | What was decided, and what it cost                 |
| [Test-driven development](ekolite-tdd-training.md) | The red, green, refactor loop with worked examples |
| [Specification](ekolite-spec.md)                   | API signatures and type definitions                |
