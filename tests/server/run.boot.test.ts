import { describe, it, expect } from 'vitest';
import { App } from '../../server/app.ts';
import { buildServerOptions } from '../../server/run.ts';

describe('ekolite run - assembling the server', () => {
  it('wires the app into createServer options with the static root resolved from the project', () => {
    const app = App.createNull();

    const options = buildServerOptions(
      app,
      { app: './app.ts', clientDir: './dist/client' },
      '/proj',
    );

    expect(options.ws).toBe(app.ws);
    expect(options.publications).toBe(app.publications);
    expect(options.rpcHandler).toBe(app.rpcHandler);
    expect(options.files).toBe(app.files);
    expect(options.staticRoot).toBe('/proj/dist/client');
  });

  it('omits the static root when no clientDir is configured', () => {
    const app = App.createNull();

    const options = buildServerOptions(app, { app: './app.ts' }, '/proj');

    expect('staticRoot' in options).toBe(false);
  });
});
