import { describe, it, expect } from 'vitest';
import { Methods } from '../../server/logic/methods';

describe('Methods', () => {
  it('registers and calls a method', async () => {
    const methods = new Methods();
    methods.define('echo', async (msg: string) => `echo: ${msg}`);
    const result = await methods.call('echo', ['hello']);
    expect(result).toBe('echo: hello');
  });
});
