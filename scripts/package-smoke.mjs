// Consumer smoke test for the npm package. Proves EkoLite is a framework in fact and
// not just in its description field: build the library, pack it, install the tarball
// into a throwaway directory OUTSIDE this repo, run a consumer that imports from
// 'ekolite' and never sees this source tree, and assert the output.
//
// Red until the package actually emits a loadable server entry and exports App. Run it
// with `node scripts/package-smoke.mjs`.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// Arm graceful shutdown from the consumer side and prove the process exits clean on a
// signal, rather than being killed. A real consumer boot: App.create holds the real
// process, so armShutdown binds the OS signal handlers. Mongo connects lazily and nothing
// here touches it, so no database needs to be running. Resolves on a clean exit 0, rejects
// on anything else (a non-zero code, or death by signal).
function assertGracefulShutdown(dir) {
  writeFileSync(
    join(dir, 'serve-and-wait.mjs'),
    [
      "import { App, createServer } from 'ekolite';",
      '',
      'const app = App.create({',
      "  mongoUri: 'mongodb://localhost:27017/ekolite_smoke_shutdown',",
      "  fileDir: './uploads',",
      '  port: 0,',
      '});',
      'const server = await createServer({ ws: app.ws });',
      "await server.listen({ port: 0, host: '127.0.0.1' });",
      'app.armShutdown();',
      "process.stdout.write('consumer-ready\\n');",
    ].join('\n'),
  );

  return new Promise((resolve, reject) => {
    const child = spawn('node', ['serve-and-wait.mjs'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let signalled = false;

    const giveUp = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`consumer never became ready or never exited:\n${out}\n${err}`));
    }, 20000);

    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (!signalled && out.includes('consumer-ready')) {
        signalled = true;
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.on('error', (spawnErr) => {
      clearTimeout(giveUp);
      reject(spawnErr);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(giveUp);
      if (code === 0 && signal === null) {
        resolve();
        return;
      }
      reject(
        new Error(
          `a consumer armed shutdown but the process exited (code=${code}, signal=${signal}) ` +
            `instead of a clean 0:\n${err}`,
        ),
      );
    });
  });
}

// Prove `ekolite run` from the outside: a consumer's project carries only an
// ekolite.config.ts and its (eko) => void app entry, no start.ts of its own. The installed
// `ekolite` bin reads the config, applies the app's definitions, and serves the consumer's
// own client. Their config and entry are TypeScript, imported by Node's native type
// stripping, so there is no build step between the developer and `ekolite run`.
function assertRunBootsTheApp(dir) {
  const READY = 'ekolite: ready on'; // mirrors READY_MESSAGE in shared/serverMessages.ts
  const port = 3987;

  mkdirSync(join(dir, 'eko-client'), { recursive: true });
  writeFileSync(join(dir, 'eko-client', 'index.html'), '<!-- served by ekolite run -->\n');
  writeFileSync(
    join(dir, 'ekolite.config.ts'),
    [
      "import { defineConfig } from 'ekolite/config';",
      "export default defineConfig({ app: './eko-app.ts', clientDir: './eko-client' });",
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'eko-app.ts'),
    [
      "import type { AppEntry } from 'ekolite/config';",
      'const app: AppEntry = (eko) => {',
      "  eko.methods.define('greet', (name) => Promise.resolve(`hi ${String(name)}`));",
      '};',
      'export default app;',
      '',
    ].join('\n'),
  );

  const bin = join(dir, 'node_modules', 'ekolite', 'dist', 'server', 'cli.js');

  return new Promise((resolve, reject) => {
    const child = spawn('node', [bin, 'run'], {
      cwd: dir,
      env: { ...process.env, EKOLITE_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let settled = false;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(giveUp);
      fn();
    };

    const giveUp = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(`ekolite run never became ready:\n${out}\n${err}`)));
    }, 20000);

    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (!out.includes(READY)) return;
      // Ready: the consumer's own client is served at /, then stop cleanly.
      fetch(`http://127.0.0.1:${String(port)}/`)
        .then(async (res) => ({ status: res.status, body: await res.text() }))
        .then(({ status, body }) => {
          if (status !== 200 || !body.includes('served by ekolite run')) {
            child.kill('SIGKILL');
            finish(() =>
              reject(new Error(`ekolite run did not serve the app's client: status=${status}\n${body}`)),
            );
            return;
          }
          child.kill('SIGTERM');
        })
        .catch((fetchErr) => {
          child.kill('SIGKILL');
          finish(() => reject(fetchErr));
        });
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.on('error', (spawnErr) => finish(() => reject(spawnErr)));
    child.on('exit', (code, signal) => {
      finish(() => {
        if (code === 0 && signal === null) {
          resolve();
          return;
        }
        reject(
          new Error(`ekolite run exited (code=${code}, signal=${signal}) instead of a clean 0:\n${err}`),
        );
      });
    });
  });
}

async function main() {
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
  let clientDir;
  try {
    run('npm', ['init', '-y'], { cwd: dir });
    // A modern ESM consumer: .ts and .js resolve as ES modules. This is what ekolite run's
    // native type stripping needs to load an ekolite.config.ts, and EkoLite is ESM anyway.
    const pkgPath = join(dir, 'package.json');
    writeFileSync(
      pkgPath,
      JSON.stringify({ ...JSON.parse(readFileSync(pkgPath, 'utf8')), type: 'module' }, null, 2),
    );
    run('npm', ['install', tarball], { cwd: dir });

    // 3. A consumer that knows only the published package: import App, define a method on
    //    it, and call it. A fresh App carries nothing of its own, so whatever the consumer
    //    defines is all there is.
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

    // 5. The shipped types must resolve from the consumer side: every declaration file
    //    may only import files that are actually in the package. A relative `.ts`
    //    specifier points at a source file the tarball never carried, so a TS consumer
    //    resolving these types would land on nothing.
    const distDir = join(dir, 'node_modules', 'ekolite', 'dist');
    const danglingTypes = readdirSync(distDir, { recursive: true })
      .filter((name) => typeof name === 'string' && name.endsWith('.d.ts'))
      .map((name) => ({
        name,
        hits: readFileSync(join(distDir, name), 'utf8').match(/['"]\.\.?\/[^'"]*\.ts['"]/g),
      }))
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

    // 7. A consumer serves their OWN client through createServer, which is the whole point
    //    of the framework running a developer's app rather than one of ours. createServer
    //    serves nothing until it is handed a root; pointed at a directory of the consumer's
    //    own, it has to return their file. app.ws is the only socket a consumer can reach,
    //    since the wrapper itself is not exported.
    clientDir = mkdtempSync(join(tmpdir(), 'ekolite-client-'));
    writeFileSync(join(clientDir, 'app.html'), '<!-- the consumer app -->');
    writeFileSync(
      join(dir, 'serve-consumer.mjs'),
      [
        "import { App, createServer } from 'ekolite';",
        '',
        'const app = App.createNull();',
        `const server = await createServer({ ws: app.ws, staticRoot: ${JSON.stringify(clientDir)} });`,
        "const res = await server.inject({ method: 'GET', url: '/app.html' });",
        'console.log(`status=${res.statusCode}`);',
        'console.log(res.body.trim());',
        'await server.close();',
      ].join('\n'),
    );
    const served = run('node', ['serve-consumer.mjs'], { cwd: dir }).trim();
    if (!served.includes('status=200') || !served.includes('<!-- the consumer app -->')) {
      throw new Error(
        `a consumer could not serve their own client through createServer:\n${served}`,
      );
    }

    // 8. A consumer arms graceful shutdown through the package surface, and the process
    //    exits clean on a signal rather than being killed. Only asserted on POSIX: Windows
    //    cannot deliver a signal to a child, the same reason smoke.integration.test.ts
    //    skips its signal test there.
    if (process.platform !== 'win32') {
      await assertGracefulShutdown(dir);
    }

    // 9. The `ekolite run` bin boots a consumer's app from its ekolite.config.ts and serves
    //    the consumer's own client, no start.ts of theirs. SIGTERM here, so POSIX only.
    if (process.platform !== 'win32') {
      await assertRunBootsTheApp(dir);
    }

    console.log('package smoke: PASS');
    console.log(`  consumer said: ${out}`);
    console.log('  declarations resolve to shipped files only');
    console.log('  a TS consumer compiles against ekolite, ekolite/shared and ekolite/client');
    console.log('  a consumer serves their own client through createServer');
    if (process.platform !== 'win32') {
      console.log('  a consumer arms graceful shutdown and the process exits 0 on a signal');
      console.log('  a consumer boots their own app with `ekolite run` and it serves their client');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(tarball, { force: true });
    if (clientDir) {
      rmSync(clientDir, { recursive: true, force: true });
    }
  }
}

try {
  await main();
} catch (err) {
  console.error(`package smoke: FAIL\n${err.message}`);
  process.exit(1);
}
