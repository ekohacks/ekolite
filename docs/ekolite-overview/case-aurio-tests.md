# Case study: AURIO Evros — QA-engineer test plan

> Audience: developers about to implement §5 of `case-aurio-analysis.md`.
> Purpose: define the test suite that drives that implementation, ordered so each test enables the next.
> Method: outside-in TDD, Nullables only, contract tests for shared interfaces, integration tests behind `vitest.integration.config.ts`.
> The suite is the spec. If a behaviour does not appear here, it is not yet in scope.

---

## Conventions (recap from `AGENTS.md`)

- One assertion style: `expect(state).toEqual(...)` and `expect(tracker.events).toEqual(...)`. Never assert on call records.
- File pattern: `x.test.ts` is fast (no network, no disk, no Mongo). `x.integration.test.ts` is allowed to hit a real local Mongo and a real local Fastify.
- Commits flow `test: red - <behaviour>` → `test: green - <behaviour>` → `refactor: <what changed>`. The QA plan below is ordered to make the first three or four commits trivial to write.
- British English in prose; identifiers are American (`color`, `behavior` are fine in code, `colour`, `behaviour` in docs).

---

## 1. Test inventory at a glance

| Code | Layer | File | Purpose |
|---|---|---|---|
| UT-1 | infrastructure | `tests/infrastructure/httpClient.test.ts` | `HttpClientWrapper` happy path, errors, tracker |
| UT-2 | infrastructure | `tests/infrastructure/scheduler.test.ts` | `Scheduler` advances deterministically; error in job does not break schedule |
| UT-3 | logic | `tests/logic/sensorIngest.parse.test.ts` | Each upstream shape maps to canonical `SensorReading`; parse failures are isolated |
| UT-4 | logic | `tests/logic/sensorIngest.boundingBox.test.ts` | Records outside the Evros bounding box are rejected and counted |
| UT-5 | logic | `tests/logic/sensorIngest.timestamps.test.ts` | `fetchedAt` always set; `measuredAt` set when upstream provides it; missing one is a warning, not an error |
| UT-6 | logic | `tests/logic/sensorIngest.upsert.test.ts` | Live collection is upserted; history collection is appended |
| UT-7 | logic | `tests/logic/sensorIngest.schedule.test.ts` | `start()` wires every source onto the scheduler; `stop()` removes them |
| UT-8 | logic | `tests/logic/sensorIngest.overlap.test.ts` | Slow tick does not overlap with the next tick on the same source |
| UT-9 | logic | `tests/logic/sensorIngest.retry.test.ts` | Three consecutive HTTP failures open the circuit; closes on next success |
| UT-10 | logic | `tests/logic/publications.aurioSensors.test.ts` | `sensors.live.byCategory` and `sensors.history.window` publication definitions |
| IT-1 | contract | `tests/infrastructure/httpClientContract.ts` | Shared assertions run against `create()` and `createNull()` so they stay symmetric |
| IT-2 | integration | `tests/server/aurio.boundingBox.integration.test.ts` | Real ingest with a captured fixture proves Imathia/Ioannina records are dropped |
| IT-3 | integration | `tests/server/aurio.scheduledIngest.integration.test.ts` | A real Fastify + real Mongo + nulled HTTP, ticks deliver readings to a real subscriber |
| IT-4 | integration | `tests/server/aurio.upstreamLatency.integration.test.ts` | A 45 s `meteo` response does not block other sources |
| IT-5 | integration | `tests/server/aurio.tickOverlap.integration.test.ts` | Confirms UT-8 under a real socket |
| IT-6 | integration | `tests/server/aurio.staleData.integration.test.ts` | `mesh` 2022 timestamps surface in the UI's `measuredAt` field |
| IT-7 | integration | `tests/server/aurio.watcherLifecycle.integration.test.ts` | Subscribe/unsubscribe storms do not leak change-stream watchers |
| IT-8 | integration | `tests/server/aurio.disconnect.integration.test.ts` | Client disconnect cleans up watches (already tested in core, re-asserted under our publications) |
| IT-9 | integration | `tests/server/aurio.fileUploadAuth.integration.test.ts` | File upload requires the shared-secret header during the pilot |

The order is not arbitrary. UT-1 and UT-2 are the only files that have **no green dependencies in EkoLite today**. Everything else depends on them, so they ship first.

---

## 2. Fixture corpus

We commit one snapshot per endpoint, captured from the live upstream, into `tests/fixtures/aurio/`. They are the single source of truth for shape. Refresh policy: only when the upstream schema changes; never as part of unrelated work.

```
tests/fixtures/aurio/
  meteo.json
  envi.json
  mesh.json
  indexes.json
  forecast.json
  bins.json       ← contains the Imathia false positives, deliberately preserved
  fleeto.json     ← contains the Ioannina false positives, deliberately preserved
  pois.json
```

These are checked in as captured. The "wrong" records are kept on purpose, because the tests that prove R2 needs them.

A second corpus, `tests/fixtures/aurio/synthetic/`, contains hand-built minimal payloads for parser tests (UT-3). One file per parser scenario, ~5 lines each. These are easier to read than the upstream blobs.

---

## 3. Unit tests — the day-one suite

### UT-1 — `HttpClientWrapper`

```ts
// tests/infrastructure/httpClient.test.ts
import { describe, it, expect } from 'vitest';
import { HttpClientWrapper } from '../../server/infrastructure/httpClient.ts';

describe('HttpClientWrapper (nullable)', () => {
  it('returns the queued response body', async () => {
    const http = HttpClientWrapper.createNull({
      responses: [{ status: 200, body: { ok: true }, durationMs: 12 }],
    });

    const response = await http.get('https://example.com/x');

    expect(response).toEqual({ status: 200, body: { ok: true }, durationMs: 12 });
  });

  it('emits one tracker event per request, in order', async () => {
    const http = HttpClientWrapper.createNull({
      responses: [
        { status: 200, body: {}, durationMs: 12 },
        { status: 500, body: {}, durationMs: 4 },
      ],
    });
    const tracker = http.trackRequests();

    await http.get('https://example.com/a');
    await http.get('https://example.com/b');

    expect(tracker.events).toEqual([
      { method: 'GET', url: 'https://example.com/a', status: 200, durationMs: 12 },
      { method: 'GET', url: 'https://example.com/b', status: 500, durationMs: 4 },
    ]);
  });

  it('throws when the queue runs dry — a sign of an under-specified test', async () => {
    const http = HttpClientWrapper.createNull({ responses: [] });

    await expect(http.get('https://example.com/x')).rejects.toThrow(
      /HttpClientWrapper.createNull: response queue exhausted/,
    );
  });

  it('propagates an error from the queue verbatim', async () => {
    const http = HttpClientWrapper.createNull({ responses: [new Error('boom')] });

    await expect(http.get('https://example.com/x')).rejects.toThrow('boom');
  });

  it('records a timeout error in the tracker, then rethrows', async () => {
    const http = HttpClientWrapper.createNull({
      responses: [new Error('Timed out after 100ms')],
    });
    const tracker = http.trackRequests();

    await expect(http.get('https://example.com/slow', { timeoutMs: 100 })).rejects.toThrow();

    expect(tracker.events).toEqual([
      expect.objectContaining({ status: 0, error: 'Timed out after 100ms' }),
    ]);
  });
});
```

The contract test runs the same assertions against `HttpClientWrapper.create()` under the integration config, hitting a local Fastify echo server. That guarantees the null and real implementations are observationally equivalent.

### UT-2 — `Scheduler`

```ts
// tests/infrastructure/scheduler.test.ts
import { describe, it, expect } from 'vitest';
import { Scheduler } from '../../server/infrastructure/scheduler.ts';

describe('Scheduler (nullable)', () => {
  it('does not run the job before advance() is called', async () => {
    const scheduler = Scheduler.createNull();
    let runs = 0;

    scheduler.every(60_000, async () => { runs += 1; });

    expect(runs).toEqual(0);
  });

  it('runs the job once per elapsed interval', async () => {
    const scheduler = Scheduler.createNull();
    let runs = 0;

    scheduler.every(60_000, async () => { runs += 1; });
    await scheduler.advance(180_000);

    expect(runs).toEqual(3);
  });

  it('continues to run after a job throws', async () => {
    const scheduler = Scheduler.createNull();
    const calls: number[] = [];

    scheduler.every(60_000, async () => {
      calls.push(calls.length);
      if (calls.length === 1) throw new Error('first one fails');
    });
    await scheduler.advance(180_000);

    expect(calls).toEqual([0, 1, 2]);
  });

  it('emits one tracker event per failed run', async () => {
    const scheduler = Scheduler.createNull();
    const tracker = scheduler.trackFailures();

    scheduler.every(60_000, async () => { throw new Error('nope'); });
    await scheduler.advance(120_000);

    expect(tracker.events).toEqual([
      expect.objectContaining({ message: 'nope' }),
      expect.objectContaining({ message: 'nope' }),
    ]);
  });

  it('stops calling the job after stop()', async () => {
    const scheduler = Scheduler.createNull();
    let runs = 0;

    const handle = scheduler.every(60_000, async () => { runs += 1; });
    await scheduler.advance(60_000);
    handle.stop();
    await scheduler.advance(120_000);

    expect(runs).toEqual(1);
  });
});
```

### UT-3 — parsing each source

One `describe` block per source, one canonical record per block, using the synthetic fixtures. The assertions are on the produced `SensorReading`, not on intermediate state.

```ts
// tests/logic/sensorIngest.parse.test.ts (sketch — one block per source)
describe('SensorIngest.parse(bins)', () => {
  it('maps a well-formed bin record to a SensorReading', () => {
    const raw = loadFixture('synthetic/bin.one.json');
    const reading = SensorIngest.parse('bins', raw, fixedClockAt('2026-06-25T16:00:00Z'));

    expect(reading).toEqual({
      _id: 'bins:2458213:2026-06-25T16:00:00.000Z',
      source: 'bins',
      sensorId: '2458213',
      sensorName: expect.any(String),
      location: { lat: 40.623313133309, lng: 22.440382037312 },
      inEvros: false,                                  // R2: this bin is in Imathia
      measurements: [
        { key: 'fillLevel', value: 68, rawValue: '68', unit: '%' },
        { key: 'voltage',   value: 3.63, rawValue: '3.63mV', unit: 'mV' },
        { key: 'temp',      value: 10, rawValue: '10', unit: '°C' },
      ],
      raw,
      fetchedAt: new Date('2026-06-25T16:00:00Z'),
      measuredAt: new Date('2025-03-04T10:00:17Z'),
      ingestVersion: '1',
    });
  });

  it('isolates a single bad record — others still parse', () => { ... });
  it('marks "(ΝΑ)" wind direction as value:null with rawValue preserved', () => { ... });
});
```

The same shape repeats for `meteo`, `mesh`, `indexes`, `forecast`, `fleeto`. The `pois` and `envi` sources do not produce sensor readings — `pois` is editorial, `envi` is empty — so they get a single test each that asserts that fact.

### UT-4 — bounding-box filter

```ts
// tests/logic/sensorIngest.boundingBox.test.ts
describe('SensorIngest bounding-box filter', () => {
  const evros = { sw: { lat: 40.65, lng: 25.65 }, ne: { lat: 41.40, lng: 26.65 } };

  it('accepts a reading inside the box', () => {
    const reading = parseFromFixture('bins.one.alexandroupoli.json');
    const filtered = SensorIngest.applyBoundingBox(reading, evros);
    expect(filtered.inEvros).toEqual(true);
  });

  it('rejects a reading outside the box but still returns it for auditability', () => {
    const reading = parseFromFixture('synthetic/bin.one.json');   // Imathia
    const filtered = SensorIngest.applyBoundingBox(reading, evros);
    expect(filtered.inEvros).toEqual(false);
  });

  it('counts each rejected reading in the IngestReport', async () => {
    const ingest = newIngestWith(['bins'], { fixture: 'bins.json' });
    const report = await ingest.ingestOnce('bins');
    expect(report.rejectedOutsideBoundingBox).toBeGreaterThan(0);
    expect(report.upsertedLive).toEqual(report.acceptedInBoundingBox);
  });
});
```

### UT-5, UT-6, UT-7, UT-8, UT-9

Outlined here, fully spelled out at implementation time.

- **UT-5 timestamps** — three blocks: upstream has `measuredAt`, upstream has none, upstream has a malformed one. The malformed case warns, does not throw.
- **UT-6 upsert vs append** — assert that two ticks against the same sensor produce **one** document in `sensors.live` and **two** in `sensors.history`.
- **UT-7 schedule wiring** — `start()` registers one `every(intervalMs, ...)` per configured source; `stop()` calls each handle's `stop()`. Asserted via `Scheduler.trackRegistrations()` (an addition to the scheduler null surface).
- **UT-8 overlap** — fake HTTP for `meteo` takes 70 s of simulated time. Advance the scheduler 60 s + 60 s + 60 s. There must be **exactly one** outstanding `meteo` fetch at any moment; the second and third ticks are skipped, each surfacing as a `tick-skipped` event in the tracker.
- **UT-9 circuit breaker** — three consecutive `HttpClientWrapper` errors flip the source to `open`; the fourth scheduled tick does not call HTTP; the fifth tick (after the cool-down) calls HTTP again and the success closes the circuit.

### UT-10 — publications

```ts
describe('AURIO publications', () => {
  it('subscribes to live readings by category', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[
        { _id: 'bins:1:ts', source: 'bins', sensorId: '1', /* … */ },
        { _id: 'meteo:1:ts', source: 'meteo', sensorId: '1', /* … */ },
      ]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);
    defineAurioPublications(pubs);                  // registers our two publications

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 's',
      name: 'sensors.live.byCategory',
      params: { category: 'bins' },
    });

    // The find query must be { source: 'bins' }, not include any Mongo operator.
    expect(client.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'added', collection: 'sensors.live' }),
      { type: 'ready', id: 's', collection: 'sensors.live' },
    ]));
  });

  it('the history.window publication rejects no params with an operator-free query', async () => {
    // Proves the operator-rewriting strategy described in case-aurio-analysis §5.4.
  });
});
```

---

## 4. Integration tests — the day-three suite

Each one wires _real_ Fastify, _real_ Mongo (`vitest.integration.config.ts`), _nulled_ HTTP. The HTTP must stay nulled — we never want CI hitting `alexandroupoli.smartiscity.gr`.

### IT-2 — bounding-box, end-to-end

This is the test that gives the political team confidence that no Imathia bin is ever shown to an Evros voter.

```ts
describe('AURIO ingest (integration) — Evros bounding box', () => {
  it('drops Imathia bins from the live publication', async () => {
    const mongo = MongoWrapper.create(process.env.MONGO_URI ?? 'mongodb://localhost:27017/ekolite-test');
    const http = HttpClientWrapper.createNull({
      responses: [{ status: 200, body: loadFixture('bins.json'), durationMs: 5 }],
    });
    const scheduler = Scheduler.createNull();
    const ingest = new SensorIngest({ http, mongo, scheduler, boundingBox: evrosBox, clock: () => new Date('2026-06-25T16:00:00Z'), sources: [binsOnly] });
    const ws = WebSocketWrapper.create();
    const publications = new Publications(mongo, ws);
    defineAurioPublications(publications);
    const server = await createServer({ ws, publications });
    await server.listen({ port: 0 });

    ingest.start();
    await scheduler.advance(60_000);

    const port = String(server.addresses()[0].port);
    const socket = ClientSocketWrapper.create(`ws://localhost:${port}/ws`);
    await socket.connect();
    const manager = new ConnectionManager(socket);
    const handle = manager.subscribe('sensors.live.byCategory', { category: 'bins' });
    await handle.ready;

    const live = [...manager.store('sensors.live').all()];
    expect(live).toEqual([]);                       // every bin in the fixture is Imathia
    // and the audit trail proves WE saw them and dropped them:
    const report = ingest.lastReport('bins');
    expect(report.fetched).toBeGreaterThan(0);
    expect(report.rejectedOutsideBoundingBox).toEqual(report.fetched);

    await socket.close();
    await server.close();
  });
});
```

The political weight of this test is real: when AURIO publishes the dashboard, the press will look at the bins. This test guarantees the wrong bins are filtered before any voter sees them.

### IT-3 — scheduled live updates

Real Fastify, real Mongo, nulled HTTP. Advance the scheduler. Watch readings arrive at a real subscriber. This is the EkoLite `livePubsub.integration.test.ts` of our use case.

### IT-4 — upstream latency does not block

Two sources configured: `bins` (returns instantly), `meteo` (45 s simulated). Advance the scheduler 60 s. `bins` must have ingested **at least once**; `meteo` is still mid-flight; no error in the tracker.

### IT-5 — overlap suppression (real socket)

Same as UT-8 but with a real client subscribing. Proves no duplicate `added` messages reach the browser when the scheduler ticks faster than HTTP responds.

### IT-6 — stale upstream surfaces honestly

Ingest the `mesh.json` fixture (2022 timestamps). Subscribe a client. Assert that the `measuredAt` field on the delivered document is **2022**, not "now". The UI relies on this distinction to grey the marker out; the dashboard's credibility depends on it.

### IT-7 — watcher lifecycle under our publications

Subscribe and unsubscribe 100 times against `sensors.live.byCategory`. `MongoWrapper.watcherCount('sensors.live')` must return 0 at the end. This re-uses the existing refcount logic in `Publications`; the test pins our publication shapes against it.

### IT-8 — disconnect cleanup

A client disconnects mid-stream. The next ingest tick must not throw, and `MongoWrapper.watcherCount` must drop to 0 for any collection that client was the sole subscriber to.

### IT-9 — file upload auth (pilot policy)

`POST /api/files` without an `X-Aurio-Token` header returns 401. With the configured shared secret, returns 201. This is the pilot's bare-minimum mitigation for R11; it is replaced by real auth in a later epic.

---

## 5. The contract test

`tests/infrastructure/httpClientContract.ts` exports `contractTests(factory: () => HttpClientWrapper)`. Both `httpClient.test.ts` (via `createNull`) and `httpClient.integration.test.ts` (via `create()` against a local echo server) import it and run the same block. If the two implementations ever drift, the suite fails before the bug reaches production.

Pattern lifted directly from `tests/infrastructure/fileStorageContract.ts` in the existing codebase — see how `FileStorageWrapper` does it today.

---

## 6. Definition of done — per task, per PR

A task is _green_ when:

1. Every test in its row (or rows) of §1 is checked in and passing.
2. `npm run test` (fast suite) passes locally in under 5 s.
3. `npm run test:integration` passes locally with a real Mongo on `localhost:27017`.
4. `npm run typecheck` and `npm run lint` pass.
5. The commit log shows the `red`/`green`/`refactor` trio for every behaviour added, in that order.
6. The corresponding row in §6 of `case-aurio-analysis.md` (the risk register) is updated with the test code that now proves the mitigation.
7. If the test required a new public API on a wrapper (`Scheduler.trackRegistrations`, `HttpClientWrapper.trackRequests`), the API is documented in the wrapper's TSDoc.
8. The PR description links back to this document and to the analyst document.

---

## 7. Anti-patterns we will reject in review

- `vi.mock(...)`, `vi.spyOn(...)`, `jest.fn(...)` — Nullables only.
- Assertions on call records (`expect(http.calls).toEqual(...)`). Assert on `tracker.events` or on Mongo state.
- Fixtures generated inside the test file rather than checked-in JSON. The fixtures are the corpus; they are reviewable artefacts in their own right.
- Tests that hit `alexandroupoli.smartiscity.gr` from CI. Ever. The contract test hits an in-process Fastify; nothing else hits the real upstream.
- A logic test that imports `MongoWrapper.create()`. If you wrote one, you have crossed the boundary between unit and integration; move the file.
- A test that exercises two unrelated behaviours. Split it.

---

## 8. Implementation order

Because each row enables the next, the order of merges is:

1. UT-1, IT-1 — `HttpClientWrapper`. Independent.
2. UT-2 — `Scheduler`. Independent.
3. UT-3 — `SensorIngest.parse` per source. Depends on nothing runtime, only fixtures.
4. UT-4, UT-5, UT-6 — the rest of `SensorIngest` core. Depends on UT-1, UT-2, UT-3.
5. UT-7, UT-8, UT-9 — scheduling, overlap, circuit breaker.
6. UT-10 — publications (small).
7. IT-2 through IT-9 — integration suite. All independent of each other but each depends on the relevant unit tests above.

A reasonable sprint slices it as:
- Sprint 1: rows 1–4 of the order above → "we can fetch and store one source end-to-end".
- Sprint 2: rows 5–7 → "the whole system runs unattended for a week without leaking watchers or making the press eat Imathia bins".

---

## 9. What the suite does _not_ test, and why

- The Leaflet UI. The browser's job is to render a `ReactiveStore`; that store is already tested in `tests/client/reactiveStore.test.ts`. We trust it.
- The political payload. Whether AURIO's "Αύριο" tab persuades voters is not a software concern.
- The RAG layer over `eko-demain` policy papers. Separate repository, separate test plan.
- Live network availability. We will _monitor_ ingest health in production (`IngestReport.status !== 'ok'` triggers an alert) but we do not test against the real upstream in CI.

---

## 10. Closing note for reviewers

If a test in this document feels precious or excessive, ask: _which §6 risk does it close?_ Every test traces to a risk in `case-aurio-analysis.md`. Tests that do not trace to a risk are noise and should be cut. Tests that close a risk and are not in this document should be added before code is written.

That tracing is the whole reason these two documents exist as a pair.
