#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runApp } from './run.ts';

// The `ekolite` command. `ekolite run` boots the app in the current directory from its
// ekolite.config.ts. Other verbs (create, build) are later stories.
async function main(): Promise<void> {
  const { positionals } = parseArgs({ allowPositionals: true });
  const verb = positionals[0];

  if (verb === 'run') {
    await runApp();
    return;
  }

  process.stderr.write(`ekolite: unknown command ${verb ?? '(none)'}. Try: ekolite run\n`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`ekolite: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
