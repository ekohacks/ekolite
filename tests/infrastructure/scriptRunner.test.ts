import { describe, expect, it } from 'vitest';
import { ScriptRunnerWrapper } from '../../server/infrastructure/scriptRunner.ts';
import { scriptRunnerContract } from './scriptRunnerContract.ts';

describe('ScriptRunnerWrapper (null)', () => {
  // Same behaviour the real runner is held to in the integration suite; the
  // expectations become the null's configured responses.
  scriptRunnerContract((expectations) => ScriptRunnerWrapper.createNull(expectations));

  // What only a null can do: answer from configuration.
  it('takes a string as shorthand for stdout with exit code 0', async () => {
    const runner = ScriptRunnerWrapper.createNull({ echo: 'hello\n' });

    expect(await runner.exec('echo', ['hello'])).toEqual({
      stdout: 'hello\n',
      stderr: '',
      exitCode: 0,
    });
  });

  it('answers empty stdout and exit code 0 for a command that was never configured', async () => {
    const runner = ScriptRunnerWrapper.createNull({ echo: ['hello\n'] });

    expect(await runner.exec('unknown', [])).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  });

  it('throws when a configured command queue is exhausted', async () => {
    const runner = ScriptRunnerWrapper.createNull({ echo: ['hello\n'] });
    await runner.exec('echo', ['first']);

    await expect(runner.exec('echo', ['second'])).rejects.toThrow('queue exhausted');
  });
});
