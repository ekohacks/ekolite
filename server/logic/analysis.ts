import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Methods } from './methods.ts';
import { type ScriptRunnerWrapper } from '../infrastructure/scriptRunner.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve a repo-relative asset path (e.g. 'scripts/countC.py') to an absolute
// one, anchored on this file's location rather than the process cwd. Same idiom
// as the static root in server/index.ts.
export function resolveAsset(relativePath: string): string {
  return resolve(__dirname, '..', '..', relativePath);
}

// runCountC resolves its script asset, asks the runner to run it under python3,
// and hands back what the script printed. The path is configuration: it arrives
// as an argument rather than sitting as a literal in here.
export function defineRunCountC(
  methods: Methods,
  runner: ScriptRunnerWrapper,
  scriptPath: string,
): void {
  methods.define('runCountC', async () => {
    const result = await runner.exec('python3', [resolveAsset(scriptPath)]);
    return result.stdout;
  });
}
