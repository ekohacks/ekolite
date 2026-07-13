// Post-build: rewrite relative `.ts` import specifiers to `.js` in the emitted
// declaration files. `rewriteRelativeImportExtensions` rewrites the runtime `.js`
// output but leaves `.d.ts` specifiers as `.ts`, which point at source files the
// package never ships. Without this, EkoLite runs for a consumer but its types don't
// resolve. Runs after `tsc -p tsconfig.build.json` in the build script.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const declarations = readdirSync(DIST, { recursive: true }).filter(
  (name) => typeof name === 'string' && name.endsWith('.d.ts'),
);

let rewritten = 0;
for (const name of declarations) {
  const path = join(DIST, name);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(/(['"]\.\.?\/[^'"]*)\.ts(['"])/g, '$1.js$2');
  if (after !== before) {
    writeFileSync(path, after);
    rewritten += 1;
  }
}

console.log(`rewrite-dts: .ts -> .js in ${rewritten} declaration file(s)`);
