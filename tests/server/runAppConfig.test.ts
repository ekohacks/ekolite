import { describe, it, expect } from 'vitest';
import { buildAppConfig } from '../../server/run.ts';

// The last leg of the wiring: a consumer's ekolite.config.ts has to reach App.create.
//
// runApp assembles its AppConfig inline today, so there is nothing to test against
// without booting the whole runner. This red proposes the same shape run.ts already
// uses for the other half of the boot, buildServerOptions(app, config, dir): a small
// pure function that turns the project's config and the environment into the options
// the next layer wants. Rename or reshape it freely; the behaviour is the point.
//
// The environment cases are here to guard the extraction rather than to pin new
// behaviour. They are what runApp does today, so they should survive the move
// unchanged, and they will say so loudly if they do not.
describe('ekolite run - assembling the app config', () => {
  it('carries the configured upload extensions through to App.create', () => {
    const config = buildAppConfig({ app: './app.ts', allowedExtensions: ['txt', 'csv'] }, {});

    expect(config.allowedExtensions).toEqual(['txt', 'csv']);
  });

  it('leaves the extensions unset when the project configures none', () => {
    const config = buildAppConfig({ app: './app.ts' }, {});

    expect(config.allowedExtensions).toBeUndefined();
  });

  it('falls back to the local defaults when the environment is empty', () => {
    const config = buildAppConfig({ app: './app.ts' }, {});

    expect(config.mongoUri).toBe('mongodb://localhost:27017/ekolite');
    expect(config.fileDir).toBe('./uploads');
    expect(config.port).toBe(3001);
  });

  it('takes the runtime knobs from the environment', () => {
    const config = buildAppConfig(
      { app: './app.ts' },
      { MONGO_URI: 'mongodb://db:27017/live', EKOLITE_PORT: '8080' },
    );

    expect(config.mongoUri).toBe('mongodb://db:27017/live');
    expect(config.port).toBe(8080);
  });

  it('prefers the project fileDir over the environment', () => {
    const config = buildAppConfig({ app: './app.ts', fileDir: './media' }, { FILE_DIR: './env' });

    expect(config.fileDir).toBe('./media');
  });
});
