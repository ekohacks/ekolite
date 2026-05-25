# ekolite — Customer Brief

Start with [ekolite-overview.md](ekolite-overview.md) for the big picture. This document explains what we're building, why, and what to expect. Stories 1-7 map directly to Smoke Tests 1-7 in the backlog.

---

## What Is This?

We're replacing the engine under the app. The app does the same thing it does today — upload BAM files, run analysis, show Hilbert curve visualizations. But the technology powering it (Meteor) is being swapped for something lighter and faster called **ekolite**.

Think of it like replacing a car engine. The car looks the same from the outside, drives the same roads, but the new engine is smaller, faster, and easier to maintain.

This migration is also the ekohacks bootcamp curriculum — developers learn Testing Without Mocks, TDD, and WebSocket patterns while building the framework.

---

## Why Are We Doing This?

| Problem with Meteor                             | How ekolite fixes it                           |
| ----------------------------------------------- | ---------------------------------------------- |
| Slow to start and rebuild during development    | Vite gives sub-100ms hot reloads               |
| 69 packages installed, most unused              | 5 runtime dependencies                         |
| Heavy protocol (DDP) with features we don't use | Mini-DDP with only what we need                |
| Hard to understand and debug                    | ~820 lines of code total, fully typed          |
| Locked into Meteor's ecosystem                  | Standard tools (Fastify, MongoDB driver, Vite) |

---

## What Does the App Do Today?

1. **Upload** a BAM genomic file
2. **Run analysis** — a Python script counts characters in the file
3. **View results** — Hilbert curve and linear signal charts
4. **See uploaded files** — list updates in real time

All four of these things will keep working exactly the same way.

---

## User Stories (= Smoke Tests)

These are the stories we'll be delivering, in priority order. In the engineering backlog (`ekolite-backlog.md`), these map directly to **Smoke Tests 1–7** under Epic 4. Behind the scenes, engineers also build infrastructure wrappers (Smoke Test 0) before starting these — that work is invisible to you as the customer but is a prerequisite.

### Iteration 1 — Foundation

**Story 1: Server starts and serves a page**

> As a user, I can open the app in my browser and see a page.

Acceptance criteria:

- Fastify server starts on a port
- Browser loads an HTML page with a script
- No errors in browser console

**Story 2: Real-time connection**

> As a user, my browser connects to the server and stays connected.

Acceptance criteria:

- WebSocket connection established on page load
- Connection stays open
- Server logs show connected client

### Iteration 2 — Data Flow

**Story 3: File list updates in real time**

> As a user, when a file is added to the database, I see it appear without refreshing.

Acceptance criteria:

- Subscribe to a publication
- Server pushes new documents to the client
- Client store holds current data
- Adding a document in MongoDB shows up in the browser

**Story 4: Run server method from browser**

> As a user, I can trigger the Python analysis script and see the result.

Acceptance criteria:

- Client calls a named method
- Server executes the method and returns the result
- Client receives the result or an error message

### Iteration 3 — File Upload

**Story 5: Upload a BAM file**

> As a user, I can upload a .bam file and see upload progress.

Acceptance criteria:

- File input accepts .bam files only
- Upload shows progress percentage
- File is stored on disk
- File metadata appears in the database
- File appears in the real-time file list (Story 3)

**Story 6: Reject invalid files**

> As a user, if I try to upload a non-.bam file, I see an error.

Acceptance criteria:

- Server rejects files without .bam extension
- Client shows a clear error message
- No file is stored

### Iteration 4 — Full Pipeline

**Story 7: Upload and analyze end-to-end**

> As a user, I can upload a BAM file, run analysis on it, and see results.

Acceptance criteria:

- Upload a file (Story 5)
- Trigger analysis (Story 4)
- Results returned to client
- This matches the current app's full workflow

---

## What You'll See During Development

- **Iteration 1** — A blank page that loads. Not exciting, but it proves the server and build system work.
- **Iteration 2** — Data appearing in the browser console in real time. Still no UI, but the plumbing works.
- **Iteration 3** — A file upload that works. You can drag a .bam file and see it stored.
- **Iteration 4** — The full loop: upload → analyze → result. Feature parity with the current app.

After iteration 4, the app UI (charts, layout, styling) can be rebuilt on top of the working foundation.

---

## Your Role

1. **Review stories** — are these the right priorities? Should anything change?
2. **Define acceptance criteria** — the "done" conditions for each story. We've drafted them above, you refine them.
3. **Accept or reject** — after each iteration, you verify the acceptance criteria are met
4. **Reprioritize** — if you learn something new, you can reorder the backlog
