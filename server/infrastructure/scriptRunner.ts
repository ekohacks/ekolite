import { execFile } from 'node:child_process';
import { ScriptResult } from '../../shared/types.ts';
import { ConfigurableResponse, EventEmitter, OutputTracker } from './output_tracker.ts';

const EXECUTION_EVENT = 'execution';

type ScriptRunnerResponse = ScriptResult | string | Error;
type ScriptRunnerResponses = Record<string, ScriptRunnerResponse | ScriptRunnerResponse[]>;

interface ProcessRunnerInterface {
  exec(command: string, args: string[]): Promise<ScriptResult>;
  trackExecutions(): OutputTracker;
}

export class ScriptRunner {
  private runner: ProcessRunnerInterface;

  private constructor(runner: ProcessRunnerInterface) {
    this.runner = runner;
  }

  static create(): ScriptRunner {
    return new ScriptRunner(new RealProcessRunner());
  }

  static createNull(responses: ScriptRunnerResponses = {}): ScriptRunner {
    return new ScriptRunner(new StubbedProcessRunner(responses));
  }

  async exec(command: string, args: string[]): Promise<ScriptResult> {
    return this.runner.exec(command, args);
  }

  trackExecutions(): OutputTracker {
    return this.runner.trackExecutions();
  }
}

class RealProcessRunner implements ProcessRunnerInterface {
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

  trackExecutions(): OutputTracker {
    throw new Error('trackExecutions is only available on null instances');
  }
}

class StubbedProcessRunner implements ProcessRunnerInterface {
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
    const response = responseQueue?.hasNext() ? responseQueue.next() : undefined;
    const result = toScriptResult(response);

    this.emitter.emit(EXECUTION_EVENT, {
      command,
      args: [...args],
      result,
    });

    return Promise.resolve(result);
  }

  trackExecutions(): OutputTracker {
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
