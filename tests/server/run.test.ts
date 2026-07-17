import { describe, it, expect } from 'vitest';
import { App } from '../../server/app.ts';
import { applyAppEntry } from '../../server/run.ts';

// The seam of `ekolite run`. The runner owns App.create; the developer's app entry
// only defines. applyAppEntry is where the two meet: the runner calls the entry with a
// narrow context backed by the assembled app's own registries, so whatever the entry
// defines is defined on the app the runner is about to serve.
//
// Narrow on purpose: the context exposes what you define against (publications, methods,
// files, scriptRunner) and nothing else, so armShutdown, close, mongo and proc stay the
// runner's. This first red pins the happy path; a follow-up red pins the narrowness.
describe('ekolite run - applying an app entry', () => {
  it('calls the entry with the app registries so its methods are callable', async () => {
    const app = App.createNull();

    applyAppEntry(app, (eko) => {
      eko.methods.define('greet', (name) => Promise.resolve(`hi ${String(name)}`));
    });

    await expect(app.methods.call('greet', ['world'])).resolves.toBe('hi world');
  });
});
