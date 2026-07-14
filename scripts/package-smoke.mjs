// Consumer smoke test for the npm package. Proves EkoLite is a framework in fact and
// not just in its description field: build the library, pack it, install the tarball
// into a throwaway directory OUTSIDE this repo, run a consumer that imports from
// 'ekolite' and never sees this source tree, and assert the output.
//
// Red until the package actually emits a loadable server entry and exports App. Run it
// with `node scripts/package-smoke.mjs`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSC = join(REPO, 'node_modules', '.bin', 'tsc');

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts });
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`\`${cmd} ${args.join(' ')}\` failed:\n${detail}`);
  }
}

function main() {
  // 1. Build the library from the repo.
  run('npm', ['run', 'build'], { cwd: REPO });

  // 2. Tarball hygiene: a consumer should receive the built package and nothing else,
  //    not the tests, docs, demo source or CI config that make up the repo.
  const packed = JSON.parse(run('npm', ['pack', '--dry-run', '--json'], { cwd: REPO }));
  const shipped = packed[0].files.map((file) => file.path);
  const strays = shipped.filter(
    (path) =>
      path !== 'package.json' &&
      path !== 'README.md' &&
      path !== 'LICENSE' &&
      !path.startsWith('dist/'),
  );
  if (strays.length > 0) {
    const sample = strays.slice(0, 8).join('\n  ');
    throw new Error(
      `tarball carries ${strays.length} files outside the allowlist (dist, README, LICENSE), e.g.:\n  ${sample}`,
    );
  }

  // 3. Pack for real and install it.
  const packLines = run('npm', ['pack'], { cwd: REPO }).trim().split('\n');
  const tarball = join(REPO, packLines[packLines.length - 1].trim());

  // 2. Install the tarball into a fresh project that has never seen this repo.
  const dir = mkdtempSync(join(tmpdir(), 'ekolite-consumer-'));
  try {
    run('npm', ['init', '-y'], { cwd: dir });
    run('npm', ['install', tarball], { cwd: dir });

    // 3. A consumer that knows only the published package. It defines its own surface,
    //    and it must inherit none of EkoLite's: a fresh app carries no files.all
    //    publication, no echo and no runCountC. Those belong to the demo, which boots in
    //    start.ts, not to the framework a consumer installs.
    const consumer = [
      "import { App } from 'ekolite';",
      '',
      'const app = App.createNull();',
      "app.methods.define('sum', (a, b) => a + b);",
      "const result = await app.methods.call('sum', [2, 3]);",
      'console.log(`sum(2,3)=${result}`);',
      '',
      "for (const inherited of ['echo', 'runCountC']) {",
      '  const outcome = await app.methods',
      '    .call(inherited, [])',
      "    .then(() => 'defined', (err) => (err?.code === 404 ? 'absent' : 'defined'));",
      '  console.log(`${inherited}=${outcome}`);',
      '}',
    ].join('\n');
    writeFileSync(join(dir, 'consumer.mjs'), consumer);

    // 4. Run it and assert on what a real consumer would see.
    const out = run('node', ['consumer.mjs'], { cwd: dir }).trim();
    if (!out.includes('sum(2,3)=5')) {
      throw new Error(`unexpected consumer output:\n${out}`);
    }
    for (const inherited of ['echo', 'runCountC']) {
      if (!out.includes(`${inherited}=absent`)) {
        throw new Error(
          `a fresh App.createNull() still carries EkoLite's own '${inherited}' method.\n` +
            `The framework is shipping its demo as if it were the framework.\n${out}`,
        );
      }
    }

    // 5. The shipped types must resolve from the consumer side: every declaration file
    //    may only import files that are actually in the package. A relative `.ts`
    //    specifier points at a source file the tarball never carried, so a TS consumer
    //    resolving these types would land on nothing.
    const distDir = join(dir, 'node_modules', 'ekolite', 'dist');
    const danglingTypes = readdirSync(distDir, { recursive: true })
      .filter((name) => typeof name === 'string' && name.endsWith('.d.ts'))
      .map((name) => ({ name, hits: readFileSync(join(distDir, name), 'utf8').match(/['"]\.\.?\/[^'"]*\.ts['"]/g) }))
      .filter((file) => file.hits);
    if (danglingTypes.length > 0) {
      const detail = danglingTypes.map((f) => `  ${f.name}: ${f.hits.join(', ')}`).join('\n');
      throw new Error(`shipped declarations import .ts files not in the package:\n${detail}`);
    }

    // 6. Types resolve from a real TS consumer: import App from the package root and a
    //    protocol type from the ekolite/shared entry, use them, and compile. This proves
    //    the exports map and the declarations line up, not just that the repo builds.
    writeFileSync(
      join(dir, 'types-consumer.ts'),
      [
        "import { App } from 'ekolite';",
        "import type { ReadyMsg } from 'ekolite/shared';",
        "import { ConnectionManager } from 'ekolite/client';",
        '',
        'const app = App.createNull();',
        "const ready: ReadyMsg = { type: 'ready', id: 'sub-1', collection: 'files' };",
        '',
        'void app;',
        'void ready;',
        'void ConnectionManager;',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        files: ['types-consumer.ts'],
      }),
    );
    run(TSC, ['--noEmit', '-p', 'tsconfig.json'], { cwd: dir });

    console.log('package smoke: PASS');
    console.log(`  consumer said: ${out}`);
    console.log('  declarations resolve to shipped files only');
    console.log('  a TS consumer compiles against ekolite, ekolite/shared and ekolite/client');
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
