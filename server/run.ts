import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type App } from './app.ts';
import { type Publications } from './logic/publications.ts';
import { type Methods } from './logic/methods.ts';
import { type Files } from './logic/files.ts';
import { type ScriptRunnerWrapper } from './infrastructure/scriptRunner.ts';
import { type EkoConfig } from './config.ts';

// The narrow surface a developer's app entry defines against. It exposes what you define
// (publications, methods, files, scriptRunner) and nothing else, so the runner's lifecycle
// (armShutdown, close, mongo, proc) stays the runner's.
export interface AppContext {
  publications: Publications;
  methods: Methods;
  files: Files;
  scriptRunner: ScriptRunnerWrapper;
  // Resolve a bundled asset (a script, a fixture) to an absolute path, against the config's
  // assetsDir. The equivalent of Meteor's Assets.absoluteFilePath: an app ships countC.py
  // and asks the runner where it landed rather than hardcoding a path.
  asset: (name: string) => string;
}

// A developer's app entry: a function the runner calls with the context, where the app
// registers its publications and methods. The default export of their app module.
export type AppEntry = (eko: AppContext) => void;

// Run the app entry against the app the runner assembled, so the entry's definitions land
// on the registries the runner is about to serve. Wired in the green step.
export function applyAppEntry(
  app: App,
  entry: AppEntry,
  _options: { assetsDir?: string } = {},
): void {
  entry({
    publications: app.publications,
    methods: app.methods,
    files: app.files,
    scriptRunner: app.scriptRunner,
    asset: () => {
      throw new Error('asset not implemented');
    },
  });
}

// Discovery: the runner finds a developer's app by convention, an `ekolite.config.ts` at
// the project root, and returns its default-exported config. The import resolves the file
// through Node's own module loader, which strips the types (Node 24) or hands off to a
// registered loader, so no build step stands between the developer and `ekolite run`.
export async function loadConfig(dir: string): Promise<EkoConfig> {
  const href = pathToFileURL(resolve(dir, 'ekolite.config.ts')).href;
  const mod = (await import(href)) as { default: EkoConfig };
  return mod.default;
}

// Resolve the config's `app` to the entry function: a path is imported from the project
// (relative to the config's directory), a function is used as-is.
export async function resolveEntry(config: EkoConfig, dir: string): Promise<AppEntry> {
  if (typeof config.app === 'function') {
    return config.app;
  }
  const href = pathToFileURL(resolve(dir, config.app)).href;
  const mod = (await import(href)) as { default: AppEntry };
  return mod.default;
}
