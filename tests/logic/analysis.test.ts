import { describe, it, expect } from 'vitest';
import { Methods } from '../../server/logic/methods.ts';
import { ScriptRunnerWrapper } from '../../server/infrastructure/scriptRunner.ts';
import { defineRunCountC } from '../../server/logic/analysis.ts';

describe('runCountC (null)', () => {
  it('returns the script stdout when called through Methods', async () => {
    const methods = new Methods();
    const runner = ScriptRunnerWrapper.createNull({ python3: 'count: 42' });

    defineRunCountC(methods, runner, 'scripts/countC.py');

    const result = await methods.call('runCountC', []);
    expect(result).toBe('count: 42');
  });

  it('runs the script path it is given, not a baked-in one', async () => {
    const methods = new Methods();
    const runner = ScriptRunnerWrapper.createNull({ python3: 'count: 0' });
    const tracker = runner.trackChanges();

    defineRunCountC(methods, runner, 'scripts/someOtherAnalysis.py');
    await methods.call('runCountC', []);

    expect(tracker.data).toHaveLength(1);
    expect(tracker.data[0]).toMatchObject({ command: 'python3' });
    const { args } = tracker.data[0] as { args: string[] };
    expect(args[0]).toMatch(/scripts\/someOtherAnalysis\.py$/);
  });
});
