import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScriptRunnerWrapper } from '../../server/infrastructure/scriptRunner.ts';
import { resolveAsset } from '../../server/logic/analysis.ts';

// Integration, shells out for real. This is the only place the actual countC.py runs
// against a real file, so it is where the script's real behaviour is pinned: what it
// counts and what it prints. The nulled tests rehearse the wiring; this proves the
// script itself. Runs only under the integration suite (npm run test:integration) and
// needs python3 on the machine.
describe('countC.py (integration)', () => {
  async function runOnSequence(sequence: string): Promise<{ stdout: string; exitCode: number }> {
    const dir = await mkdtemp(join(tmpdir(), 'ekolite-countc-'));
    const dataPath = join(dir, 'sequence.txt');
    await writeFile(dataPath, sequence);
    try {
      const runner = ScriptRunnerWrapper.create();
      return await runner.exec('python3', [resolveAsset('scripts/countC.py'), dataPath]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('counts the C characters in a sequence and exits cleanly', async () => {
    // Mixed case on purpose. Pinning 4 here fixes the decision as case-insensitive:
    // both c and C count. If countC should only count the base C (upper) or only a
    // literal lowercase c, change the script and this number together.
    const { stdout, exitCode } = await runOnSequence('cCcC');

    expect(exitCode).toBe(0);
    expect(Number(stdout.trim())).toBe(4);
  });

  it('counts zero when the sequence has no C', async () => {
    const { stdout, exitCode } = await runOnSequence('abdefg');

    expect(exitCode).toBe(0);
    expect(Number(stdout.trim())).toBe(0);
  });

  it('prints just the number, so Number(stdout.trim()) parses cleanly', async () => {
    // runCountC does Number(stdout.trim()). If the script printed a label such as
    // 'count: 3' this would be NaN, so the contract is a bare integer on stdout.
    const { stdout } = await runOnSequence('gattacaCCC');

    expect(Number.isNaN(Number(stdout.trim()))).toBe(false);
    expect(stdout.trim()).toMatch(/^\d+$/);
  });
});
