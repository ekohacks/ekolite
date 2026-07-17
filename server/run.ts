import { type App } from './app.ts';
import { type Publications } from './logic/publications.ts';
import { type Methods } from './logic/methods.ts';
import { type Files } from './logic/files.ts';
import { type ScriptRunnerWrapper } from './infrastructure/scriptRunner.ts';

// The narrow surface a developer's app entry defines against. It exposes what you define
// (publications, methods, files, scriptRunner) and nothing else, so the runner's lifecycle
// (armShutdown, close, mongo, proc) stays the runner's.
export interface AppContext {
  publications: Publications;
  methods: Methods;
  files: Files;
  scriptRunner: ScriptRunnerWrapper;
}

// A developer's app entry: a function the runner calls with the context, where the app
// registers its publications and methods. The default export of their app module.
export type AppEntry = (eko: AppContext) => void;

// Run the app entry against the app the runner assembled, so the entry's definitions land
// on the registries the runner is about to serve. Wired in the green step.
export function applyAppEntry(_app: App, _entry: AppEntry): void {
  throw new Error('applyAppEntry not implemented');
}
