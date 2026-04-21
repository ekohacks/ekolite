import { describe, it, expect } from 'vitest';
import { ScriptRunnerWrapper } from '../../server/infrastructure/scriptRunner.ts';

describe('ScriptRunnerWrapper (real)', () => {
  const runner = ScriptRunnerWrapper.create();

  it('executes a command and returns stdout', async () => {
    const result = await runner.exec('echo', ['hello']);
    expect(result).toEqual({ stdout: 'hello\n', stderr: '', exitCode: 0 });
  });

  it('returns stderr and non-zero exit code on failure', async () => {
    const result = await runner.exec('node', [
      '-e',
      'process.stderr.write("oops"); process.exit(1)',
    ]);
    expect(result.stderr).toBe('oops');
    expect(result.exitCode).toBe(1);
  });
});
