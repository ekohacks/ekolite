import { describe, it, expect } from 'vitest';
import { ScriptRunnerWrapper } from '../../server/infrastructure/scriptRunner.ts';

describe('ScriptRunnerWrapper (null)', () => {
  it('returns configured response for a command', async () => {
    const runner = ScriptRunnerWrapper.createNull({ echo: 'hello\n' });
    const result = await runner.exec('echo', ['hello']);
    expect(result).toEqual({ stdout: 'hello\n', stderr: '', exitCode: 0 });
  });

  it('consumes configured responses for repeated command calls before falling back', async () => {
    const runner = ScriptRunnerWrapper.createNull({
      echo: ['hello\n', { stdout: 'again\n', stderr: '', exitCode: 0 }],
    });

    await expect(runner.exec('echo', ['hello'])).resolves.toEqual({
      stdout: 'hello\n',
      stderr: '',
      exitCode: 0,
    });
    await expect(runner.exec('echo', ['again'])).resolves.toEqual({
      stdout: 'again\n',
      stderr: '',
      exitCode: 0,
    });
    await expect(runner.exec('echo', ['fallback'])).resolves.toEqual({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
  });

  it('returns configured non-zero exit codes', async () => {
    const runner = ScriptRunnerWrapper.createNull({
      node: [{ stdout: '', stderr: 'oops', exitCode: 1 }],
    });

    await expect(runner.exec('node', ['-e', 'process.exit(1)'])).resolves.toEqual({
      stdout: '',
      stderr: 'oops',
      exitCode: 1,
    });
  });

  it('throws configured execution errors', async () => {
    const runner = ScriptRunnerWrapper.createNull({
      python: [new Error('spawn ENOENT')],
    });

    await expect(runner.exec('python', ['script.py'])).rejects.toThrow('spawn ENOENT');
  });

  it('tracks successful executions', async () => {
    const runner = ScriptRunnerWrapper.createNull({
      echo: ['hello\n'],
      node: [{ stdout: '', stderr: 'oops', exitCode: 1 }],
    });
    const tracker = runner.trackChanges();

    await runner.exec('echo', ['hello']);
    await runner.exec('node', ['-e', 'process.exit(1)']);

    expect(tracker.data).toHaveLength(2);
    expect(tracker.data[0]).toMatchObject({
      command: 'echo',
      args: ['hello'],
      result: { stdout: 'hello\n', stderr: '', exitCode: 0 },
    });
    expect(tracker.data[1]).toMatchObject({
      command: 'node',
      args: ['-e', 'process.exit(1)'],
      result: { stdout: '', stderr: 'oops', exitCode: 1 },
    });
  });

  it('does not track executions that throw configured errors', async () => {
    const runner = ScriptRunnerWrapper.createNull({
      python: [new Error('spawn ENOENT')],
    });
    const tracker = runner.trackChanges();

    await expect(runner.exec('python', ['script.py'])).rejects.toThrow('spawn ENOENT');
    expect(tracker.data).toEqual([]);
  });

  it('returns empty stdout when command has no configured response', async () => {
    const runner = ScriptRunnerWrapper.createNull();
    const result = await runner.exec('unknown', []);
    expect(result).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  });
});
