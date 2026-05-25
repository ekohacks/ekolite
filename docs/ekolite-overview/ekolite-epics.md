# ekolite — Epics

Start with [ekolite-overview.md](ekolite-overview.md) for the big picture. Epics are the highest level of work — what the app does for the user.

---

## Current State

| Feature                             | Status                                       |
| ----------------------------------- | -------------------------------------------- |
| BAM file upload with progress       | Working                                      |
| File validation (.bam only)         | Working                                      |
| Python script execution (countC.py) | Working                                      |
| Real-time file list                 | Working                                      |
| Navigation (Home, About, Usage)     | Working                                      |
| HilbertCurveViewArea                | Placeholder — shows dummy Highcharts data    |
| LinearSignalArea                    | Placeholder — shows static text              |
| Chromosome selector                 | Placeholder — dropdown exists, not connected |
| Coordinates input                   | Placeholder — input exists, not connected    |
| Color choosers                      | Placeholder — buttons exist, no handlers     |
| Saturation sliders                  | Placeholder — sliders exist, not connected   |
| "Add more" uploaders                | Placeholder — button exists, no handler      |
| Multi-BAM comparison (tes.py)       | Not integrated                               |

### User Flow (Today)

```
Researcher opens app
  → Sees Home page with sidebar + main area
  → Selects a .bam file via BamUploader
  → File uploads with progress bar
  → File stored on server disk (assets/app/uploads/)
  → File appears in real-time file list
  → Clicks "Submit Job GO!"
  → Server runs countC.py on uploaded files
  → Result returned to browser console
  → (Hilbert curve + linear signal would render here — currently placeholders)
```

---

## Epic 1: Upload Genomic Data

> **As a researcher, I can upload BAM files so the system has data to analyze.**

### What the User Does

1. Selects a `.bam` file from their computer
2. Sees upload progress (0% → 100%)
3. Sees "Upload complete!" confirmation
4. Sees the file appear in the file list (real-time, no refresh needed)
5. Can upload multiple files (up to ~5 via multiple BamUploader slots)

---

## Epic 2: Analyze Genomic Data

> **As a researcher, I can run analysis scripts on my uploaded BAM files and get results.**

### What the User Does

1. Uploads one or more BAM files (Epic 1)
2. Clicks "Submit Job GO!" button
3. Waits for Python script to process the files
4. Sees the result (currently in console; will feed into visualizations)

**Python scripts available:**

- `countC.py` — Counts 'C' characters in BAM files (test/demo script)
- `tes.py` — Compares chromosome alignment across BAM files using `pysam`. Not yet integrated.

---

## Epic 3: Visualize Results

> **As a researcher, I can see Hilbert curve and linear signal visualizations of my genomic data.**

### What the User Does

1. Sees the HilbertCurveViewArea — a 2D Hilbert curve mapping genomic signal intensity
2. Sees the LinearSignalArea — a 1D intensity chart along genomic coordinates
3. Selects a chromosome from the dropdown
4. Enters or adjusts coordinate ranges (e.g., `chr1:123456-234567`)
5. Chooses colors for each BAM file
6. Adjusts saturation sliders to control intensity
7. Visualizations update based on selections

### Current State — Mostly Placeholder

```
HilbertCurveViewArea.jsx
  → Highcharts chart with dummy data: [1, 3, 2, 4, 3]
  → 500×500px with border
  → Not connected to real BAM data

LinearSignalArea.jsx
  → Static text: "Interactive Linear Signal Area"
  → 100px height
  → Not connected to real data

Controls (in Home.jsx):
  → Chromosome dropdown: <Select placeholder="Chromosome 1" /> — not connected
  → Coordinates input: <Input placeholder="chr1:123456-234567" /> — not connected
  → Color choosers: <Button>Color chooser 1</Button> — no handlers
  → Saturation sliders: <Slider defaultValue={50}> — not connected
```

### What Actually Needs Building

| Feature                                   | Status   | Notes                                             |
| ----------------------------------------- | -------- | ------------------------------------------------- |
| Connect countC.py output to Hilbert chart | Not done | Need to parse Python output into chart data       |
| Integrate tes.py for multi-BAM comparison | Not done | Script exists but not wired up                    |
| Real Hilbert curve rendering              | Not done | Need algorithm to map 1D genomic → 2D Hilbert     |
| Chromosome selector drives data           | Not done | Dropdown needs onChange handler                   |
| Coordinate range filtering                | Not done | Input needs parsing + query filtering             |
| Color assignment per BAM file             | Not done | Buttons need color picker + state                 |
| Saturation controls visualization         | Not done | Sliders need to control chart opacity/intensity   |
| "Add more" uploads                        | Not done | Button needs to dynamically add BamUploader slots |

This feature work is **independent of the migration**.

---

## Epic 4: Build EkoLite

> **Build the framework, prove it works with smoke tests, then migrate the app.**

| #   | Smoke Test                      | What It Proves                            | Pass Criteria                                                                  | Backlog Reference          |
| --- | ------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ | -------------------------- |
| 0   | Infrastructure wrappers built   | We can test without real systems          | All parity tests green: Null behaves like Real                                 | Stories 0.A–0.D            |
| 1   | Server starts and serves a page | Fastify + Vite replace Meteor build       | Browser loads HTML, no console errors                                          | Stories 1.A, 1.B           |
| 2   | Real-time connection            | WebSocket replaces DDP transport          | WS connects, stays open, server logs client                                    | Stories 2.A, 2.B           |
| 3   | File list updates in real time  | Pub/sub replaces Meteor.publish/subscribe | Insert doc in MongoDB → appears in browser without refresh                     | Stories 3.A, 3.B, 3.C      |
| 4   | Run server method from browser  | Methods replace Meteor.methods/call       | Client calls method → server executes → client gets result                     | Stories 4.A, 4.B, 4.C      |
| 5   | Upload a BAM file               | @fastify/multipart replaces ostrio:files  | Upload .bam → progress shown → file on disk → metadata in DB → appears in list | Stories 5.A–5.D            |
| 6   | Reject invalid files            | Validation replaces onBeforeUpload        | Upload .txt → 400 error → no file stored → client shows error                  | (Covered by 5.A, 5.C, 5.D) |
| 7   | End-to-end pipeline             | Full app works on ekolite                 | Upload .bam → subscribe sees it → call runCountC → get result                  | Stories 7.A, 7.B           |

**Smoke test 7 is the gate.** When it passes, the framework does everything Meteor does for our app. Only then do we start migrating real components.

### Migration Order

```
Phase 1: Build the framework + smoke tests (this epic)
  Iteration 0: Infrastructure wrappers       → Smoke test 0 (parity tests green)
  Iteration 1: Server + WebSocket            → Smoke tests 1, 2
  Iteration 2: Pub/sub + Methods             → Smoke tests 3, 4
  Iteration 3: File uploads                  → Smoke tests 5, 6
  Iteration 4: Wire everything together      → Smoke test 7 (THE GATE)
                                               ─────────────────────────
                                               Framework proven. Go/no-go.

Phase 2: Migrate the UI onto ekolite (touches Epics 1, 2, 3)
  (See ekolite-backlog.md "What Happens After Smoke Test 7" for exact file replacements)
  → Replace Meteor.subscribe with MeteorLight.subscribe in Home.jsx
  → Replace Meteor.callAsync with MeteorLight.call in GoSubmitButton.jsx
  → Replace BamCollection.insert with MeteorLight.upload in BamUploader.jsx
  → Replace useTracker with store.on('change') in Home.jsx
  → Remove Meteor.startup, use Vite entry point
  → Acceptance: app works identically to Meteor version

Phase 3: Feature work (Epic 3 — visualizations)
  → Connect real data to charts
  → Implement chromosome/coordinate controls
  → Wire color and saturation to Highcharts
  → Integrate tes.py for multi-BAM analysis
```

---

## Epic Summary

| Epic                    | Status              |
| ----------------------- | ------------------- |
| 1: Upload Genomic Data  | Working (on Meteor) |
| 2: Analyze Genomic Data | Working (on Meteor) |
| 3: Visualize Results    | Mostly placeholder  |
| 4: Build EkoLite        | Not started         |

### Dependency Map

```
Epic 4 (Migration) ──────── must complete before ────────┐
                                                          │
Epic 1 (Upload) ─── migrates during/after Epic 4 ────────┤
Epic 2 (Analyze) ── migrates during/after Epic 4 ────────┤
                                                          │
Epic 3 (Visualize) ── feature work, independent ──────── can happen anytime
                       of migration (React/Highcharts      but benefits from
                       don't depend on Meteor)             cleaner data flow
```
