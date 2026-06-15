import { execFile } from 'node:child_process';
import { ScriptResult } from '../../shared/types.ts';
import { ConfigurableResponse, EventEmitter, OutputTracker } from './outputTracker.ts';

const EXECUTION_EVENT = 'execution';

type ScriptRunnerResponse = ScriptResult | string | Error;
type ScriptRunnerResponses = Record<string, ScriptRunnerResponse | ScriptRunnerResponse[]>;

interface ProcessRunnerLike {
  exec(command: string, args: string[]): Promise<ScriptResult>;
  watch(onChange: (raw: unknown) => void): () => void;
}

export class ScriptRunnerWrapper {
  private readonly runner: ProcessRunnerLike;
  private readonly emitter = new EventEmitter();
  private stopWatch?: () => void;

  private constructor(runner: ProcessRunnerLike) {
    this.runner = runner;
  }

  static create(): ScriptRunnerWrapper {
    return new ScriptRunnerWrapper(new RealProcessRunner());
  }

  static createNull(responses: ScriptRunnerResponses = {}): ScriptRunnerWrapper {
    return new ScriptRunnerWrapper(new StubbedProcessRunner(responses));
  }

  async exec(command: string, args: string[]): Promise<ScriptResult> {
    const result = await this.runner.exec(command, args);
    this.openWatchIfNeeded();
    return result;
  }

  trackChanges(): OutputTracker {
    this.openWatchIfNeeded();
    return new OutputTracker(this.emitter, EXECUTION_EVENT);
  }

  private openWatchIfNeeded(): void {
    if (this.stopWatch) {
      return;
    }
    this.stopWatch = this.runner.watch((raw) => {
      this.emitter.emit(EXECUTION_EVENT, raw);
    });
  }
}

class RealProcessRunner implements ProcessRunnerLike {
  private readonly emitter = new EventEmitter();

  exec(command: string, args: string[]): Promise<ScriptResult> {
    return new Promise((resolve) => {
      execFile(command, args, (error, stdout, stderr) => {
        const result: ScriptResult = {
          stdout,
          stderr,
          exitCode: error?.code ? (typeof error.code === 'number' ? error.code : 1) : 0,
        };
        this.emitter.emit(EXECUTION_EVENT, { command, args: [...args], result });
        resolve(result);
      });
    });
  }

  watch(onChange: (raw: unknown) => void): () => void {
    const listener = (data: unknown) => {
      onChange(data);
    };
    this.emitter.on(EXECUTION_EVENT, listener);
    return () => {
      this.emitter.off(EXECUTION_EVENT, listener);
    };
  }
}

class StubbedProcessRunner implements ProcessRunnerLike {
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

  watch(onChange: (raw: unknown) => void): () => void {
    const listener = (data: unknown) => {
      onChange(data);
    };
    this.emitter.on(EXECUTION_EVENT, listener);
    return () => {
      this.emitter.off(EXECUTION_EVENT, listener);
    };
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
