import { describe, it, expect } from 'vitest';
import { defineConfig } from '../../server/config.ts';

describe('defineConfig', () => {
  it('returns the config it is given', () => {
    const config = defineConfig({ app: './server/app.ts', clientDir: './dist/client' });

    expect(config).toEqual({ app: './server/app.ts', clientDir: './dist/client' });
  });

  // Red against the type, not the runtime: defineConfig is identity, so this passes
  // under vitest (esbuild strips types without checking them) and fails under
  // `npm run typecheck` until EkoConfig gains the field. The typecheck is the gate
  // that matters here, since the whole point of defineConfig is the compile error a
  // consumer gets on a wrong or missing key.
  it('carries the allowed upload extensions', () => {
    const config = defineConfig({ app: './app.ts', allowedExtensions: ['txt', 'csv'] });

    expect(config.allowedExtensions).toEqual(['txt', 'csv']);
  });
});
