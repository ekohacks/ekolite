# EkoLite — Overview

A ~820-line real-time backend framework for biotech apps. Built with TypeScript, tested without mocks.

---

## What It Does

EkoLite is a lightweight real-time backend framework. Five standard tools do the whole job:

| Capability     | How                                             |
| -------------- | ----------------------------------------------- |
| HTTP server    | Fastify                                         |
| Real-time data | WebSocket + Mini-DDP (6 message types)          |
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

Client and server talk over WebSocket with 6 message types:

```
Client → Server:         Server → Client:
  subscribe                ready
  unsubscribe              added / changed / removed
  method                   result / error
```

Full DDP has ~15 message types. We use 6.

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

| Doc                        | What's in it                                          |
| -------------------------- | ----------------------------------------------------- |
| `ekolite-system-design.md` | How the framework works, concept by concept           |
| `ekolite-adrs.md`          | Architecture decisions and why we made them           |
| `ekolite-tdd-training.md`  | Red-green-refactor tutorial with worked examples      |
| `ekolite-tdd.md`           | Nullable code reference, test pyramid, test structure |
| `ekolite-spec.md`          | API signatures and type definitions                   |
