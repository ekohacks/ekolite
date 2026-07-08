// Consumer smoke test for the npm package. Proves EkoLite is a framework in fact and
// not just in its description field: build the library, pack it, install the tarball
// into a throwaway directory OUTSIDE this repo, run a consumer that imports from
// 'ekolite' and never sees this source tree, and assert the output.
//
// Red until the package actually emits a loadable server entry and exports App. Run it
// with `node scripts/package-smoke.mjs`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts });
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`\`${cmd} ${args.join(' ')}\` failed:\n${detail}`);
  }
}

function main() {
  // 1. Build and pack the library from the repo.
  run('npm', ['run', 'build'], { cwd: REPO });
  const packLines = run('npm', ['pack'], { cwd: REPO }).trim().split('\n');
  const tarball = join(REPO, packLines[packLines.length - 1].trim());

  // 2. Install the tarball into a fresh project that has never seen this repo.
  const dir = mkdtempSync(join(tmpdir(), 'ekolite-consumer-'));
  try {
    run('npm', ['init', '-y'], { cwd: dir });
    run('npm', ['install', tarball], { cwd: dir });

    // 3. A consumer that knows only the published package.
    const consumer = [
      "import { App } from 'ekolite';",
      '',
      'const app = App.createNull();',
      "app.methods.define('sum', (a, b) => a + b);",
      "const result = await app.methods.call('sum', [2, 3]);",
      'console.log(`sum(2,3)=${result}`);',
    ].join('\n');
    writeFileSync(join(dir, 'consumer.mjs'), consumer);

    // 4. Run it and assert on what a real consumer would see.
    const out = run('node', ['consumer.mjs'], { cwd: dir }).trim();
    if (!out.includes('sum(2,3)=5')) {
      throw new Error(`unexpected consumer output:\n${out}`);
    }

    console.log('package smoke: PASS');
    console.log(`  consumer said: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(tarball, { force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(`package smoke: FAIL\n${err.message}`);
  process.exit(1);
}
