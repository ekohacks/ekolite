import { describe, it, expect } from 'vitest';
import { Methods } from '../../server/logic/methods.ts';

describe('Methods', () => {
  it('registers and calls a method', async () => {
    const methods = new Methods();
    methods.define('echo', (msg) => Promise.resolve(`echo: ${String(msg)}`));
    const result = await methods.call('echo', ['hello']);
    expect(result).toBe('echo: hello');
  });

  it('throws when calling a method that is not defined', async () => {
    const methods = new Methods();
    await expect(methods.call('missing', [])).rejects.toThrow('Method not found: missing');
  });

  it('refuses to redefine a method that already exists', () => {
    const methods = new Methods();
    methods.define('echo', (msg) => Promise.resolve(`echo: ${String(msg)}`));
    expect(() => {
      methods.define('echo', () => Promise.resolve('shadowed'));
    }).toThrow('Method already defined: echo');
  });

  it('passes non-string arguments through to the handler and back', async () => {
    const methods = new Methods();
    methods.define('sum', (a, b) => Promise.resolve((a as number) + (b as number)));
    const result = await methods.call('sum', [2, 3]);
    expect(result).toBe(5);
  });
});
