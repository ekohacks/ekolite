import { describe, it, expect } from 'vitest';
import { Methods } from '../../server/logic/methods.ts';

describe('Methods', () => {
  it('registers and calls a method', async () => {
    const methods = new Methods();
    methods.define('echo', async (msg: string) => Promise.resolve(`echo: ${msg}`));
    const result = await methods.call('echo', ['hello']);
    expect(result).toBe('echo: hello');
  });

  it('throws structured error for unknown method', async () => {
    const methods = new Methods();
    await expect(methods.call('nope', [])).rejects.toMatchObject({
      code: 404,
      message: 'Method not found: nope',
    });
  });
});
