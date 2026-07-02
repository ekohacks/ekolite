import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Methods } from './methods.ts';
import { type Files } from './files.ts';
import { type ScriptRunnerWrapper } from '../infrastructure/scriptRunner.ts';
import { fileNotFound } from '../../shared/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve a repo-relative asset path (e.g. 'scripts/countC.py') to an absolute
// one, anchored on this file's location rather than the process cwd. Same idiom
// as the static root in server/index.ts.
export function resolveAsset(relativePath: string): string {
  return resolve(__dirname, '..', '..', relativePath);
}

// runCountC resolves an uploaded file by id, runs the count script against that
// file, parses the number the script printed, and writes it back onto the file's
// document so it streams to subscribers through files.all. The count also comes
// back to the caller. The script path is configuration, injected at this seam.
export function defineRunCountC(
  methods: Methods,
  runner: ScriptRunnerWrapper,
  files: Files,
  scriptPath: string,
): void {
  methods.define('runCountC', async (fileId) => {
    const file = await files.locate(fileId as string);
    if (!file) {
      throw fileNotFound(fileId as string);
    }
    const { stdout } = await runner.exec('python3', [resolveAsset(scriptPath), file.path]);
    const count = Number(stdout.trim());
    await files.recordCountC(file._id, count);
    return count;
  });
}
