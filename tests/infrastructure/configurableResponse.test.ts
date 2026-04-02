import { describe, it, expect } from 'vitest';
import { ConfigurableResponse } from '../../server/infrastructure/output_tracker.ts';

describe('ConfigurableResponse', () => {
  it('returns responses in order', () => {
    const responses = new ConfigurableResponse([[{ _id: '1', title: 'First' }], []]);
    expect(responses.next()).toEqual([{ _id: '1', title: 'First' }]);
    expect(responses.next()).toEqual([]);
  });

  it('throws when queue is exhausted', () => {
    const responses = new ConfigurableResponse(['one']);
    responses.next();
    expect(() => responses.next()).toThrow('exhausted');
  });

  it('throws error responses instead of returning them', () => {
    const responses = new ConfigurableResponse([new Error('Connection lost')]);
    expect(() => responses.next()).toThrow('Connection lost');
  });

  it('rejects empty objects', () => {
    expect(() => new ConfigurableResponse([{}])).toThrow();
  });

  it('allows null as a valid response', () => {
    const responses = new ConfigurableResponse([null]);
    expect(responses.next()).toBeNull();
  });

  it('allows empty arrays as a valid response', () => {
    const responses = new ConfigurableResponse([[]]);
    expect(responses.next()).toEqual([]);
  });
});
