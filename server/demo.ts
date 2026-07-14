import { type App } from './app.ts';
import { defineRunCountC } from './logic/analysis.ts';

// EkoLite's own demo, and nothing a consumer inherits.
//
// These three definitions used to live in the App constructor, which meant every
// consumer's first App.create() came back with a files.all publication, an echo
// method and a runCountC method wired to a Python script they had never heard of.
// The framework was shipping its demo as if it were the framework.
//
// They live here now. start.ts calls this, so the demo still boots exactly as it did,
// and App hands a consumer an empty stage. This is deliberately not exported from
// server/index.ts: it is not part of the package surface.

export const DEFAULT_COUNTC_SCRIPT = 'scripts/countC.py';

export interface DemoOptions {
  countCScript?: string;
}

export function defineDemo(app: App, options: DemoOptions = {}): void {
  app.publications.define('files.all', () => ({ collection: 'files', query: {} }));
  app.methods.define('echo', (message) => Promise.resolve(`echo: ${String(message)}`));
  defineRunCountC(
    app.methods,
    app.scriptRunner,
    app.files,
    options.countCScript ?? DEFAULT_COUNTC_SCRIPT,
  );
}
