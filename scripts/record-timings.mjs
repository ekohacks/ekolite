// Distil a vitest JSON report into one comparable timing record.
//
// A fast integration suite is a design constraint, and the number that proves it only
// means something with the machine attached: a 3 second run on a 16 core desktop and a
// 3 second run on a 2 core CI runner are different facts. So every record carries the
// OS, CPU, core count and Node version alongside the per file durations.
//
// Reads .timings/raw.json (written by the json reporter during
// `npm run test:integration`), writes the distilled record to .timings/latest.json and
// appends the same record to .timings/history.jsonl, so a machine accumulates its own
// trend line locally. CI uploads the directory as a build artefact, one per platform.
//
// This runs as posttest:integration, which npm skips when the tests fail. That is
// deliberate: a hang that resolves into a failure is a bug report, not a data point,
// and must not land in the timing history looking like a real measurement.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, hostname, platform, release } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TIMINGS_DIR = resolve(REPO, '.timings');

const report = JSON.parse(readFileSync(resolve(TIMINGS_DIR, 'raw.json'), 'utf8'));

// Slowest first, so the file to look at is the first one printed. Paths are made
// repo-relative with forward slashes so a Windows record diffs cleanly against a
// Linux one.
const files = report.testResults
  .map((result) => ({
    file: relative(REPO, result.name).split(sep).join('/'),
    ms: Math.round(result.endTime - result.startTime),
    tests: result.assertionResults.length,
  }))
  .sort((a, b) => b.ms - a.ms);

const record = {
  recordedAt: new Date().toISOString(),
  machine: {
    os: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    node: process.version,
    hostname: hostname(),
  },
  // Files run in parallel, so the sum of file durations overstates what a human waits
  // for. Wall clock is first file in to last file out, as vitest saw it.
  wallClockMs: Math.round(Math.max(...report.testResults.map((r) => r.endTime)) - report.startTime),
  files,
};

writeFileSync(resolve(TIMINGS_DIR, 'latest.json'), `${JSON.stringify(record, null, 2)}\n`);
appendFileSync(resolve(TIMINGS_DIR, 'history.jsonl'), `${JSON.stringify(record)}\n`);

const width = Math.max(...files.map((f) => f.file.length));
const table = files.map(
  (f) => `${f.file.padEnd(width)}  ${String(f.ms).padStart(6)} ms  ${String(f.tests)} tests`,
);
process.stdout.write(
  [
    `integration timings: ${record.machine.os}/${record.machine.arch}, ${String(record.machine.cores)} cores, node ${record.machine.node}`,
    ...table,
    `wall clock ${String(record.wallClockMs)} ms -> .timings/latest.json`,
    '',
  ].join('\n'),
);
