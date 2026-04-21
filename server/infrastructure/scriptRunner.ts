import { execFile } from 'node:child_process';
import { ScriptResult } from '../../shared/types.ts';

interface ScriptRunnerInterface {
  exec(command: string, args: string[]): Promise<ScriptResult>;
}

export class ScriptRunnerWrapper {
  private runner: ScriptRunnerInterface;

  private constructor(runner: ScriptRunnerInterface) {
    this.runner = runner;
  }

  static create(): ScriptRunnerWrapper {
    return new ScriptRunnerWrapper(new RealScriptRunner());
  }

  static createNull(responses: Record<string, string> = {}): ScriptRunnerWrapper {
    return new ScriptRunnerWrapper(new StubbedScriptRunner(responses));
  }

  async exec(command: string, args: string[]): Promise<ScriptResult> {
    return this.runner.exec(command, args);
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
}

class StubbedScriptRunner implements ScriptRunnerInterface {
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
