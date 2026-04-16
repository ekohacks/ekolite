import { execFile } from 'node:child_process';
import { ScriptResult } from '../../shared/types.ts';

interface ProcessRunnerInterface {
  exec(command: string, args: string[]): Promise<ScriptResult>;
}

export class ScriptRunnerWrapper {
  private runner: ProcessRunnerInterface;

  private constructor(runner: ProcessRunnerInterface) {
    this.runner = runner;
  }

  static create(): ScriptRunnerWrapper {
    return new ScriptRunnerWrapper(new RealProcessRunner());
  }

  static createNull(responses: Record<string, string> = {}): ScriptRunnerWrapper {
    return new ScriptRunnerWrapper(new StubbedProcessRunner(responses));
  }

  async exec(command: string, args: string[]): Promise<ScriptResult> {
    return this.runner.exec(command, args);
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
}

class StubbedProcessRunner implements ProcessRunnerInterface {
  private responses: Record<string, string>;

  constructor(responses: Record<string, string>) {
    this.responses = responses;
  }

  exec(command: string, _args: string[]): Promise<ScriptResult> {
    return Promise.resolve({
      stdout: this.responses[command] ?? '',
      stderr: '',
      exitCode: 0,
    });
  }
}
