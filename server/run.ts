import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { App, type AppConfig } from './app.ts';
import { createServer, type ServerOptions } from './index.ts';
import { READY_MESSAGE } from '../shared/serverMessages.ts';
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
  options: { assetsDir?: string } = {},
): void {
  const { assetsDir } = options;
  entry({
    publications: app.publications,
    methods: app.methods,
    files: app.files,
    scriptRunner: app.scriptRunner,
    asset: (name) => {
      if (assetsDir === undefined) {
        throw new Error(`Cannot resolve asset "${name}": no assetsDir configured`);
      }
      return resolve(assetsDir, name);
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

// Turn the assembled app and the project's config into the options createServer wants: the
// app's own wiring, plus the built client resolved to an absolute staticRoot. No clientDir
// means no static handler, which createServer reads as an honest "serves nothing". Wired in
// the green step.
export function buildServerOptions(app: App, config: EkoConfig, dir: string): ServerOptions {
  const base: ServerOptions = {
    ws: app.ws,
    publications: app.publications,
    rpcHandler: app.rpcHandler,
    files: app.files,
  };
  if (config.clientDir === undefined) {
    return base;
  }
  return { ...base, staticRoot: resolve(dir, config.clientDir) };
}

// Turn the project's config and the environment into the config App.create wants, the same
// way buildServerOptions turns them into the options createServer wants. The runtime knobs
// (mongoUri, port) come from the environment so a deploy overrides them, fileDir is the
// project's to state with the environment as a fallback, and the upload allowlist is the
// project's alone: no allowedExtensions means the key stays off, which App reads as "keep
// the framework default" rather than "allow nothing".
export function buildAppConfig(config: EkoConfig, env: NodeJS.ProcessEnv): AppConfig {
  const base: AppConfig = {
    mongoUri: env.MONGO_URI ?? 'mongodb://localhost:27017/ekolite',
    fileDir: config.fileDir ?? env.FILE_DIR ?? './uploads',
    port: Number(env.EKOLITE_PORT ?? env.PORT ?? 3001),
  };
  if (config.allowedExtensions === undefined) {
    return base;
  }
  return { ...base, allowedExtensions: config.allowedExtensions };
}

// The full boot `ekolite run` performs, in the developer's project directory: read the
// config, assemble the App against real infrastructure, apply the app's own definitions,
// serve it over Fastify with the app's client, arm graceful shutdown, and announce
// readiness. This is start.ts done from a developer's config rather than by hand; the
// runtime knobs (mongoUri, port) stay in the environment so a deploy overrides them.
export async function runApp(dir: string = process.cwd()): Promise<void> {
  const config = await loadConfig(dir);
  const entry = await resolveEntry(config, dir);

  const appConfig = buildAppConfig(config, process.env);
  const app = App.create(appConfig);

  const assetsDir = config.assetsDir === undefined ? undefined : resolve(dir, config.assetsDir);
  applyAppEntry(app, entry, assetsDir === undefined ? {} : { assetsDir });

  const server = await createServer(buildServerOptions(app, config, dir));
  await server.listen({ port: appConfig.port, host: '0.0.0.0' });
  app.armShutdown();
  process.stdout.write(`${READY_MESSAGE} http://localhost:${String(appConfig.port)}\n`);
}
