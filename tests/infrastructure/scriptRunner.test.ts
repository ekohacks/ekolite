import { describe, it, expect } from 'vitest';
import { ScriptRunnerWrapper } from '../../server/infrastructure/scriptRunner.ts';

describe('ScriptRunnerWrapper (null)', () => {
  it('returns configured response for a command', async () => {
    const runner = ScriptRunnerWrapper.createNull({ echo: 'hello\n' });
    const result = await runner.exec('echo', ['hello']);
    expect(result).toEqual({ stdout: 'hello\n', stderr: '', exitCode: 0 });
  });

  it('returns empty stdout when command has no configured response', async () => {
    const runner = ScriptRunnerWrapper.createNull();
    const result = await runner.exec('unknown', []);
    expect(result).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  });
});
