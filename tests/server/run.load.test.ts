import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { App } from '../../server/app.ts';
import { applyAppEntry, loadConfig, resolveEntry, type AppEntry } from '../../server/run.ts';

const FIXTURE = fileURLToPath(new URL('../fixtures/run', import.meta.url));

describe('ekolite run - loading a project', () => {
  it('loads the config from the project directory', async () => {
    const config = await loadConfig(FIXTURE);

    expect(config.clientDir).toBe('./dist/client');
  });

  it('resolves an app entry given as a path by importing it', async () => {
    const entry = await resolveEntry({ app: './app.ts' }, FIXTURE);
    const app = App.createNull();

    applyAppEntry(app, entry);

    await expect(app.methods.call('ping', [])).resolves.toBe('pong');
  });

  it('resolves an inline function entry as itself', async () => {
    const fn: AppEntry = (eko) => {
      eko.methods.define('noop', () => Promise.resolve(null));
    };

    await expect(resolveEntry({ app: fn }, FIXTURE)).resolves.toBe(fn);
  });
});
