import { execFile } from 'node:child_process';
import { ScriptResult } from '../../shared/types.ts';
import { ConfigurableResponse, EventEmitter, OutputTracker } from './outputTracker.ts';

const EXECUTION_EVENT = 'execution';

type ScriptRunnerResponse = ScriptResult | string | Error;
type ScriptRunnerResponses = Record<string, ScriptRunnerResponse | ScriptRunnerResponse[]>;

interface ScriptRunnerInterface {
  exec(command: string, args: string[]): Promise<ScriptResult>;
  trackChanges(): OutputTracker;
}

export class ScriptRunnerWrapper {
  private runner: ScriptRunnerInterface;

  private constructor(runner: ScriptRunnerInterface) {
    this.runner = runner;
  }

  static create(): ScriptRunnerWrapper {
    return new ScriptRunnerWrapper(new RealScriptRunner());
  }

  static createNull(responses: ScriptRunnerResponses = {}): ScriptRunnerWrapper {
    return new ScriptRunnerWrapper(new StubbedProcessRunner(responses));
  }

  async exec(command: string, args: string[]): Promise<ScriptResult> {
    return this.runner.exec(command, args);
  }

  trackChanges(): OutputTracker {
    return this.runner.trackChanges();
  }
}

class RealScriptRunner implements ScriptRunnerInterface {
  exec(command: string, args: string[]): Promise<ScriptResult> {
    return new Promise((resolve) => {
      execFile(command, args, (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr,
          exitCode: error?.code ? (typeof error.code === 'number' ? error.code : 1) : 0,
        });
      });
    });
  }

  trackChanges(): OutputTracker {
    throw new Error('trackExecutions is only available on null instances');
  }
}

class StubbedProcessRunner implements ScriptRunnerInterface {
  private responses = new Map<string, ConfigurableResponse>();
  private emitter = new EventEmitter();

  constructor(responses: ScriptRunnerResponses) {
    for (const [command, response] of Object.entries(responses)) {
      const queue = Array.isArray(response) ? response : [response];
      this.responses.set(command, new ConfigurableResponse(queue));
    }
  }

  exec(command: string, args: string[]): Promise<ScriptResult> {
    const responseQueue = this.responses.get(command);
    const response = responseQueue !== undefined ? responseQueue.next() : undefined;
    const result = toScriptResult(response);

    this.emitter.emit(EXECUTION_EVENT, {
      command,
      args: [...args],
      result,
    });

    return Promise.resolve(result);
  }

  trackChanges(): OutputTracker {
    return new OutputTracker(this.emitter, EXECUTION_EVENT);
  }
}

function toScriptResult(response: unknown): ScriptResult {
  if (typeof response === 'string') {
    return {
      stdout: response,
      stderr: '',
      exitCode: 0,
    };
  }

  if (response === undefined) {
    return {
      stdout: '',
      stderr: '',
      exitCode: 0,
    };
  }

  return response as ScriptResult;
}
