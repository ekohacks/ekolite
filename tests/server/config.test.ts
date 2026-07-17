import { describe, it, expect } from 'vitest';
import { defineConfig } from '../../server/config.ts';

describe('defineConfig', () => {
  it('returns the config it is given', () => {
    const config = defineConfig({ app: './server/app.ts', clientDir: './dist/client' });

    expect(config).toEqual({ app: './server/app.ts', clientDir: './dist/client' });
  });
});
