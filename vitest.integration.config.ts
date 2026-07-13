import { defineConfig } from 'vitest/config';

// The budget around an integration test must be larger than every timeout inside it.
//
// ServerProcess waits up to 10s for the ready line and gives a server 5s to leave after a
// stop. Both of those carry the diagnostics you need when a boot goes wrong: what the
// child printed on stdout, what it printed on stderr, what exit code it left with.
// vitest's default testTimeout is 5000ms, shorter than either, so vitest killed the test
// before the harness could finish its sentence, and every failure arrived as a bare
// `Test timed out in 5000ms` with nothing attached to it.
//
// That is how a Windows boot failure spent a week looking like a shutdown bug. The one
// machine that could have told us what was wrong was the one machine this default gagged.
//
// These are ceilings, not waits. A green run on Linux touches neither: boot, fetch and
// stop together cost about half a second. Keep both above DEFAULT_READY_TIMEOUT_MS and
// DEFAULT_STOP_GRACE_MS in tests/helpers/serverProcess.ts. If that ordering ever breaks,
// tests/helpers/serverProcess.integration.test.ts is the first thing to time out.
const TEST_BUDGET_MS = 30_000;

export default defineConfig({
  test: {
    root: '.',
    include: ['**/*.integration.test.ts'],
    testTimeout: TEST_BUDGET_MS,
    hookTimeout: TEST_BUDGET_MS,
  },
});
