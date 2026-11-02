import { describe } from 'vitest';
import { ScriptRunnerWrapper } from '../../server/infrastructure/scriptRunner.ts';
import { scriptRunnerContract } from './scriptRunnerContract.ts';

// Narrow integration test: the runner against real processes. The behaviour is the
// contract list the unit file runs on the null; here the expectations are ignored and
// node answers for itself.
describe('ScriptRunnerWrapper (real)', () => {
  scriptRunnerContract(() => ScriptRunnerWrapper.create());
});
