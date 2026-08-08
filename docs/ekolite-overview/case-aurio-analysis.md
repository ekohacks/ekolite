# Case study: AURIO Evros — senior analyst report

> Audience: developers, contributors, and the AURIO political team.
> Purpose: establish the problem domain, the constraints, and the system boundaries
> for a real application built on EkoLite — _before_ writing code.
> Method: domain analysis, system context, component design, risk register.
> Companion document: `case-aurio-tests.md` (the QA-engineer test plan that follows from this analysis).

---

## 1. Context

The Municipality of Alexandroupoli runs a smart-city stack called **SmartIsCity** (vendor: DotSoft, Thessaloniki), with a public dashboard at <https://alexandroupoli.smartiscity.gr/>. Behind the dashboard sits a `PHP` REST API at `https://alexandroupoli.smartiscity.gr/api/api.php?func=<name>` that is:

- **public** — no API key, no `Authorization` header, no auth of any kind
- **unauthenticated by design** — funded by public money, served to citizens
- **undocumented** — no Swagger, no published schema, no SLA, no rate-limit policy
- **brittle** — `?func=meteo` regularly takes ~45 s to respond; payloads are inconsistent

The AURIO political programme `eko-demain/content/programmes/evros-local-programme.md` ("Evros 2028") commits to running for Mayor of Alexandroupoli on a platform of **participatory budgeting**, **community energy**, **local procurement**, and **village revival**. To make those commitments tangible to voters, AURIO needs to demonstrate that:

1. The current municipal data already exists and is already paid for by citizens.
2. The data, when read honestly, surfaces patterns the current administration does not show.
3. For each surfaced pattern, AURIO has a concrete policy alternative.

This is the use case EkoLite will serve.

---

## 2. Why EkoLite is the right substrate

EkoLite's existing capabilities, mapped to the use case:

| AURIO need | EkoLite primitive that satisfies it |
|---|---|
| Pull live values from an external HTTP API on a schedule | _(missing — see §6 risks)_ |
| Persist time-series sensor readings | `MongoWrapper` (`server/infrastructure/mongo.ts`) |
| Push updates to the browser the moment a reading lands | `Publications` + Mongo change streams (`server/logic/publications.ts`) |
| Browser map that stays in sync as readings flow in | `ClientSocketWrapper` + `ConnectionManager` + `ReactiveStore` |
| Citizen-submitted photographs of overflowing bins, alongside the live data | `Files` upload route + `FileStorageWrapper` |
| Test the whole pipeline without hitting Mongo, the network, or the SmartIsCity API | The Nullables pattern — every wrapper has `create()` _and_ `createNull()` |

The framework's published constraint surface (`AGENTS.md`) is also a perfect cultural fit for AURIO: strict TDD, no mocks, British-English prose, conventional commits showing `red`/`green`/`refactor`. The party's claim is _political craftsmanship_; the framework's claim is _software craftsmanship_. They reinforce each other.

---

## 3. Domain analysis — what the data actually says

This section is the part of the report that exists because we _looked at the data_ rather than at the marketing PDF.

### 3.1 Endpoint catalogue (observed, June 2026)

| Endpoint | Records | Top-level shape | Notes |
|---|---:|---|---|
| `?func=meteo` | 3 stations | Array, nested `details[]` of 12 vars | ~45 s latency observed. One station carries `sensor_description: "πρόβλημα"`. |
| `?func=envi` | 0 | Empty array | Environmental/air-quality stream is wired but unpopulated. |
| `?func=mesh` | 3 stations | Array, nested `details[]` of WiFi & Bluetooth counts | Counts are stamped **`wfCountDate: "2022-06-17"`** — four-year-old data. |
| `?func=indexes` | 4 indices | Array, nested `details[]` of one band | UV / Discomfort / Humidity bands. Computed values. |
| `?func=forecast` | 1 row | Flat | Current + tomorrow temperature only. |
| `?func=bins` | 44 bins | Flat, per-bin `value` (fill %) | **Coordinates are not in Alexandroupoli** — lat ≈ 40.62, lng ≈ 22.44 sits in _Alexandreia, Imathia_, ~250 km west of Evros. |
| `?func=fleeto` | 3 vehicles | Flat, live lat/lng/speed | **Coordinates sit near Ioannina** (lat ≈ 39.7, lng ≈ 20.8) — wrong region. |
| `?func=pois&lang=el` | 35 POIs | Flat | Cultural / civic points of interest. Editorial content, not sensors. |

### 3.2 Sense-making

Four observations follow from §3.1, and they shape the entire system design.

**A. The data is mislabelled across municipalities.** The same API endpoint serves bins from Alexandreia (Imathia) and trucks from the Ioannina region under the Alexandroupoli host. Whether this is a vendor multi-tenancy bug, a stale snapshot, or a shared backend, **AURIO cannot show this data to voters without filtering by bounding box**. The Evros bounding box is approximately:

```
south-west: 40.65, 25.65
north-east: 41.40, 26.65
```

Anything outside this box is dropped at ingest time and recorded as a quality incident.

**B. The data is partially stale.** `mesh` carries 2022 timestamps. The system must therefore distinguish _ingest time_ (when we fetched it) from _measurement time_ (when the sensor produced it). Showing 2022 crowd counts as "tonight at the Lighthouse" would be a credibility-destroying error.

**C. There are no top-level timestamps.** Only `bins.date` and the nested `mesh.details[*].wfCountDate` carry sensor-side times. The ingest layer must add `fetchedAt` to every document so historical analysis ("how often did the Aisymi bin overflow last month?") becomes possible even when upstream omits a timestamp.

**D. The free response includes broken units.** `meteo` payload mixes numeric measurements (`"4.944000000"`) and string measurements (`"(ΝΑ)"` for wind direction). The ingest layer must parse defensively; the canonical store must keep both `raw` and `value` so a parse failure does not destroy the record.

### 3.3 Canonical domain model

We collapse all sensor varieties into one normalised document so publications, queries and the client store remain simple. Each Mongo collection holds documents of this shape:

```ts
// shared/aurio/types.ts (proposed)
export interface SensorReading {
  _id: string;              // "<source>:<sensorId>:<isoFetchedAt>" — stable, deterministic
  source: 'meteo' | 'envi' | 'mesh' | 'indexes' | 'forecast' | 'bins' | 'fleeto';
  sensorId: string;         // upstream identifier (mysensor_id, bin id, fleeto id, …)
  sensorName: string;       // human-readable
  location: { lat: number; lng: number };
  inEvros: boolean;         // bounding-box filter result — kept on the document for auditability
  measurements: Measurement[];
  raw: Record<string, unknown>;   // verbatim upstream payload, never parsed away
  fetchedAt: Date;          // when WE got it (always present)
  measuredAt?: Date;        // when the SENSOR claims it was produced (often missing)
  ingestVersion: string;    // schema version of the ingest pipeline that produced this doc
}

export interface Measurement {
  key: string;              // 'temperature' | 'humidity' | 'fillLevel' | 'wifiCount' | …
  value: number | null;     // numeric where parseable
  rawValue: string;         // verbatim string from upstream
  unit?: string;            // '°C', '%', 'mm', …
  band?: string;            // 'low' | 'moderate' | 'high' — for indices
}
```

Two collections, not one collection per source:

- `sensors.live` — the most recent reading per `sensorId`. Upserted on every fetch. This is what the public dashboard subscribes to.
- `sensors.history` — append-only, one document per fetch. This is what AURIO's _political_ visualisations (heatmaps, weekly tendencies) query.

Splitting them lets `Publications` keep its happy path simple (a tiny live collection, narrow change-stream traffic) while the history collection grows freely without flooding subscribed clients.

---

## 4. System context

```
   ┌──────────────────────────┐
   │  SmartIsCity public API   │   (external, no SLA, occasionally stale or mislabelled)
   │   8 endpoints, JSON       │
   └────────────┬─────────────┘
                │ HTTPS, polled every N minutes
                ▼
   ┌──────────────────────────┐
   │  HttpClientWrapper        │   ← NEW infrastructure wrapper (nullable)
   │   create() / createNull() │
   └────────────┬─────────────┘
                ▼
   ┌──────────────────────────┐
   │  Scheduler                │   ← NEW infrastructure wrapper (nullable, advances on tick)
   └────────────┬─────────────┘
                ▼
   ┌──────────────────────────┐
   │  SensorIngest             │   ← NEW logic module
   │   - fetch each endpoint   │
   │   - normalise to          │
   │     SensorReading         │
   │   - bounding-box filter   │
   │   - upsert .live          │
   │   - append .history       │
   │   - emit IngestReport     │
   └────────────┬─────────────┘
                ▼
   ┌──────────────────────────┐
   │  MongoWrapper             │   ← already exists
   └────────────┬─────────────┘
                │ change streams
                ▼
   ┌──────────────────────────┐
   │  Publications             │   ← already exists
   │   sensors.byCategory      │
   │   sensors.history.window  │
   └────────────┬─────────────┘
                │ WebSocket / mini-DDP
                ▼
   ┌──────────────────────────┐
   │  AURIO browser app        │   uses ConnectionManager + ReactiveStore
   │   - Leaflet map           │   already in evros-map repo, ready to lift
   │   - "Now / Yesterday /    │
   │     Tomorrow" tabs        │
   └──────────────────────────┘
```

The dashed boxes are the only new pieces. Everything else exists in `ekolite/server/` and `ekolite/client/` today.

---

## 5. Component design — what to add to EkoLite

### 5.1 `HttpClientWrapper` — infrastructure

A thin nullable wrapper around `fetch` that mirrors the convention of the existing wrappers in `server/infrastructure/`. Its surface area is intentionally tiny.

```ts
class HttpClientWrapper {
  static create(): HttpClientWrapper;
  static createNull(options?: {
    responses?: Array<HttpResponse | Error>;   // queue, consumed in order
  }): HttpClientWrapper;

  get(url: string, options?: { timeoutMs?: number }): Promise<HttpResponse>;

  // OutputTracker emits one event per fetch: { method, url, status, durationMs, error? }
  trackRequests(): OutputTracker;
}

interface HttpResponse {
  status: number;
  body: unknown;          // JSON-parsed
  durationMs: number;
}
```

Design notes:

- **Timeout is mandatory** at the call site — there is no default that hides the SmartIsCity `meteo` latency problem.
- **Body is parsed once** at the wrapper boundary; the logic layer never re-parses.
- **No retries here.** Retries are policy; the wrapper is mechanism. Retries live in `SensorIngest`.

### 5.2 `Scheduler` — infrastructure

```ts
class Scheduler {
  static create(): Scheduler;             // real setInterval-based
  static createNull(): Scheduler;         // does nothing until advance(ms) is called

  every(intervalMs: number, job: () => Promise<void>): { stop(): void };
  advance(ms: number): Promise<void>;     // tests only — drains pending ticks
}
```

Design notes:

- The null version advances **deterministically** when the test calls `advance(15 * 60 * 1000)`. No `vi.useFakeTimers()` anywhere.
- `every` returns a `stop` handle so a test or shutdown can cancel cleanly.
- Errors in a job do **not** stop the schedule; they are surfaced through a tracker so tests can assert on them.

### 5.3 `SensorIngest` — logic

The first piece of EkoLite code that is application-specific. It composes the three wrappers and is itself tested with nulled wrappers only.

```ts
class SensorIngest {
  constructor(opts: {
    http: HttpClientWrapper;
    mongo: MongoWrapper;
    scheduler: Scheduler;
    boundingBox: BoundingBox;     // injected — Evros today, anywhere tomorrow
    clock: () => Date;            // injectable, defaults to () => new Date()
    sources?: SourceConfig[];     // defaults to the 8 SmartIsCity endpoints
  });

  start(): void;                  // wires every source onto the scheduler
  stop(): void;
  ingestOnce(source: SourceId): Promise<IngestReport>;   // exposed for tests

  trackReports(): OutputTracker;  // one IngestReport per source per tick
}

interface IngestReport {
  source: SourceId;
  startedAt: Date;
  finishedAt: Date;
  status: 'ok' | 'http-error' | 'parse-error' | 'partial';
  fetched: number;                // how many upstream records arrived
  acceptedInBoundingBox: number;
  rejectedOutsideBoundingBox: number;
  parseFailures: number;
  upsertedLive: number;
  appendedHistory: number;
  warnings: string[];             // e.g. "measuredAt missing on 3/3 records"
}
```

Design notes:

- The `IngestReport` is the audit trail the political team uses to demonstrate that the AURIO platform never silently throws data away. Every record either landed in Mongo or appears in `rejectedOutsideBoundingBox`/`parseFailures`.
- The clock is injectable so `fetchedAt` is deterministic in tests.
- `sources` is injectable so a test exercising the `bins` parser does not need to wire all eight.

### 5.4 New publications

Two publication families on top of the existing engine.

```ts
publications.define('sensors.live.byCategory',
  (params) => ({
    collection: 'sensors.live',
    query: typeof params?.category === 'string' ? { source: params.category } : {},
  }));

publications.define('sensors.history.window',
  (params) => ({
    collection: 'sensors.history',
    query: {
      source: params?.source,
      fetchedAt: {                       // intentional: this WILL be rejected
        $gte: params?.from,              // by hasMongoOperator() — see risks §6
        $lte: params?.to,
      },
    },
  }));
```

`sensors.history.window` shows up a constraint we have to engineer around: `Publications` currently rejects any params that contain Mongo operators (`hasMongoOperator`). This is correct security default. For the history window we will need either a curated `define()` that builds the operator server-side from primitive params (`from`/`to` as ISO strings) — _that_ is the route we take — or a dedicated RPC. The publication definition above is _aspirational_ and the real code will move the range expansion inside the closure so no operator ever crosses the wire.

### 5.5 Client view (sketch only — not part of this PR)

The browser app reuses the existing `evros-map` Leaflet project. Three tabs:

1. **Τώρα** — `subscribe('sensors.live.byCategory')`, render markers, colour by `source`.
2. **Χθες** — `subscribe('sensors.history.window', { source: 'bins', from, to })`, render as heatmap by hour-of-day.
3. **Αύριο** — static AURIO policy cards keyed to the patterns the data exposes. No data subscription.

---

## 6. Risk register

Each risk has an owner, a mitigation, and the test that proves the mitigation works. The test column points forward to the QA document.

| # | Risk | Likelihood | Impact | Mitigation | Verified by |
|---|---|---|---|---|---|
| R1 | Upstream API rate-limits or blocks us | Medium | Schedule stalls | Default ingest cadence ≥ 15 min, with `Retry-After` honoured; circuit breaker after 3 consecutive failures | IT-3, IT-4 |
| R2 | Upstream returns mislabelled data (Imathia/Ioannina under Alexandroupoli host) | **Confirmed today** | Voters see false "Evros" data | Bounding-box filter at ingest; `rejectedOutsideBoundingBox` counter; daily report | IT-2 |
| R3 | Upstream returns stale data (mesh = 2022) | **Confirmed today** | Voters see false "live" labels | Distinguish `fetchedAt` from `measuredAt`; UI greys out readings older than 24 h | UT-5, IT-6 |
| R4 | `meteo` 45 s latency causes ingest tick to overlap with itself | High | Memory leak, duplicate writes | Per-source mutex; skip-this-tick-if-still-running policy | IT-5 |
| R5 | A single bad upstream record poisons the whole tick | Medium | Whole source missing for an hour | Parse failures are per-record; the report carries `parseFailures > 0` but other records still land | UT-3 |
| R6 | Mongo change-stream watcher accumulates as clients reconnect | Medium | Server resource leak | EkoLite already refcounts watches via `closeWatchIfUnused`; we add an integration test that proves it under our subscribe/unsubscribe pattern | IT-7 |
| R7 | Citizen uploads (overflow photos) bypass moderation | Medium | Legal / political | File routes require a signed token tied to the citizen account; quarantine bucket until a moderator approves | Out of scope for this PR — tracked in epic |
| R8 | GDPR — `mesh` carries WiFi/Bluetooth crowd counts | Low (aggregated) | Reputational | The data is already aggregated upstream; we store it verbatim, never join to identifiers; a privacy note in the dashboard footer | Audited in `eko-demain/content/programmes/privacy-policy.md` |
| R9 | EkoLite has no scheduler today, no HTTP client today | Confirmed | Cannot ship without building them | This PR — `Scheduler`, `HttpClientWrapper` | UT-1, UT-2 |
| R10 | EkoLite has no reconnect/resubscribe yet (README "What is planned, not yet built") | Confirmed | Mobile users on flaky Evros networks lose live updates | Acceptable for pilot; reconnect is the next epic. UI shows a "live | reconnecting | offline" badge | IT-8 |
| R11 | Auth missing on file routes (README) | Confirmed | Anyone can upload | Pilot: file routes guarded by a shared secret env var. Real auth in a later epic | IT-9 |

---

## 7. Out of scope for this PR

- The Leaflet UI itself. We deliver only the server-side primitives + publications + a thin `client/demo/aurio.html` that proves the wire is hot. The full UI is pulled from `evros-map` in a separate piece of work.
- Reconnect and resubscribe (R10).
- Real auth (R11).
- The RAG layer over policy documents from `eko-demain`. Sketched in §8, built later.

---

## 8. Forward look — RAG over AURIO policy

When `sensors.history` is six weeks deep, the political payoff is _explanation_, not display. A citizen asks "γιατί βρωμάνε οι κάδοι στη γειτονιά μου;" and a RAG layer joins (a) the bin's six-week fill-level history with (b) the relevant pillar in `eko-demain/content/programmes/policy-papers/04-democracy.md` (participatory budgeting) and (c) §"From the Mayor's Office" of `evros-local-programme.md`. The `doc-chat-rag` repo already prototypes this stack (Python, Supabase, OpenAI). The integration path is: EkoLite owns the sensor data, `doc-chat-rag` owns the policy corpus, and a thin `methods.define('aurio.explain', …)` RPC bridges them. This belongs in a follow-up analysis.

---

## 9. Next document

`case-aurio-tests.md` — the QA-engineer test plan derived from §3, §5, §6.
