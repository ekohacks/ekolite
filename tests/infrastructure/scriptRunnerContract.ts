import { expect, it } from 'vitest';
import type { ScriptRunnerWrapper } from '../../server/infrastructure/scriptRunner.ts';
import type { ScriptResult } from '../../shared/types.ts';

// The behaviour every ScriptRunnerWrapper must honour, real or null (observatory ADR 0023,
// rule three). The real runner runs the commands below for real; the null is handed, per
// test, exactly what the real one will answer, so the two can never quietly disagree. If
// they do, one of these fails.
export type Expectations = Record<string, (ScriptResult | Error)[]>;
export type MakeScriptRunner = (expectations: Expectations) => ScriptRunnerWrapper;

const HELLO: ScriptResult = { stdout: 'hello', stderr: '', exitCode: 0 };
const OOPS: ScriptResult = { stdout: '', stderr: 'oops', exitCode: 1 };
const SAY_HELLO = ['-e', 'process.stdout.write("hello")'];
const FAIL = ['-e', 'process.stderr.write("oops"); process.exit(1)'];
const MISSING = 'ekolite-no-such-command-zqx';
const CANNOT_SPAWN = (): Error => new Error(`spawn ${MISSING} ENOENT`);

export function scriptRunnerContract(make: MakeScriptRunner): void {
  it('runs a command and answers its stdout with exit code 0', async () => {
    const runner = make({ node: [HELLO] });

    expect(await runner.exec('node', SAY_HELLO)).toEqual(HELLO);
  });

  it('answers the stderr and the non-zero exit code of a command that fails, without throwing', async () => {
    const runner = make({ node: [OOPS] });

    expect(await runner.exec('node', FAIL)).toEqual(OOPS);
  });

  it('rejects when the command cannot be spawned at all, naming the error', async () => {
    const runner = make({ [MISSING]: [CANNOT_SPAWN()] });

    await expect(runner.exec(MISSING, [])).rejects.toThrow(/ENOENT/);
  });

  it('tracks each execution as command, args and result, in order, never one that could not spawn', async () => {
    const runner = make({ node: [HELLO, OOPS], [MISSING]: [CANNOT_SPAWN()] });
    const tracker = runner.trackChanges();

    await runner.exec('node', SAY_HELLO);
    await runner.exec('node', FAIL);
    await runner.exec(MISSING, []).catch(() => undefined);

    expect(tracker.data).toEqual([
      { command: 'node', args: SAY_HELLO, result: HELLO },
      { command: 'node', args: FAIL, result: OOPS },
    ]);
  });
}
