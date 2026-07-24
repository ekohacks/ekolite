import { type AppEntry } from './run.ts';

// Re-export the app-authoring types so a consumer types their config and entry from one
// place: `import { defineConfig, type AppEntry } from 'ekolite/config'`.
export type { AppEntry, AppContext } from './run.ts';

// The shape of an ekolite.config.ts. `app` is the app entry: a path to the module the
// runner imports, or the entry function inline. The dirs point the runner at the app's own
// files: the built client to serve at /, the scripts and assets to resolve at runtime, and
// where uploads land. allowedExtensions is the upload allowlist, lowercase and without the
// dot; leaving it out keeps the framework default rather than accepting everything, so
// widening is something a project asks for. mongoUri and port stay env driven, so a deploy
// overrides them without editing this file.
export interface EkoConfig {
  app: string | AppEntry;
  clientDir?: string;
  assetsDir?: string;
  fileDir?: string;
  allowedExtensions?: string[];
}

// Identity, but typed: a consumer writes `export default defineConfig({ ... })` and gets
// autocomplete and a compile error on a wrong or missing key. Wired in the green step.
export function defineConfig(config: EkoConfig): EkoConfig {
  return config;
}
