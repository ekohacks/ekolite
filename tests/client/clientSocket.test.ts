import { describe, expect, it } from 'vitest';
import { ClientSocketWrapper, isServerMessage } from '../../client/clientSocket.ts';
import { ReadyMsg, ServerMessage, UnsubscribeMsg } from '../../shared/protocol.ts';

describe('ClientSocketWrapper URL validation', () => {
  it('rejects non-websocket URLs', () => {
    expect(() => ClientSocketWrapper.create('http://localhost:8080')).toThrow();
  });

  it('rejects URLs without a protocol', () => {
    expect(() => ClientSocketWrapper.create('localhost:8080')).toThrow();
  });

  it('accepts ws:// URLs', () => {
    expect(() => ClientSocketWrapper.create('ws://localhost:8080')).not.toThrow();
  });

  it('accepts wss:// URLs', () => {
    expect(() => ClientSocketWrapper.create('wss://localhost:8080')).not.toThrow();
  });
});

describe('ClientSocketWrapper parsing contract', () => {
  it('drops a non-JSON server payload without crashing the inbound listener', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    await socket.connect();

    const received: ServerMessage[] = [];
    socket.onMessage((m) => received.push(m));

    server.sendRaw('not-json-at-all');
    server.send({ type: 'ready', id: '1' });

    expect(received).toEqual([{ type: 'ready', id: '1' }]);
  });
});

describe('ClientSocketWrapper (null)', () => {
  it('is not connected before connect is called', () => {
    const socket = ClientSocketWrapper.createNull();
    expect(socket.isConnected).toBe(false);
  });
  it('is connected after connect is called', async () => {
    const socket = ClientSocketWrapper.createNull();

    await socket.connect();

    expect(socket.isConnected).toBe(true);
  });
  it('is not connected after close is called', async () => {
    const socket = ClientSocketWrapper.createNull();

    await socket.connect();
    await socket.close();

    expect(socket.isConnected).toBe(false);
  });
  it('can receive a message from the server', async () => {
    const received: ServerMessage[] = [];
    const message: ReadyMsg = { type: 'ready', id: '1' };
    const socket = ClientSocketWrapper.createNull();
    const unsubscribe = socket.onMessage((msg) => received.push(msg));

    await socket.connect();
    const server = socket.simulateServer();
    server.send(message);

    expect(received).toHaveLength(1);
    expect(received).toEqual([{ type: 'ready', id: '1' }]);

    unsubscribe();
  });
  it('can send a message to the server', async () => {
    const message: UnsubscribeMsg = { type: 'unsubscribe', id: '1' };

    const socket = ClientSocketWrapper.createNull();
    const tracker = socket.trackMessages();
    await socket.connect();
    await socket.send(message);
    expect(tracker.data).toHaveLength(1);
    expect(tracker.data[0]).toEqual({ type: 'unsubscribe', id: '1' });
  });

  it('outPutTracker tracks messages sent by the client only', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    const tracker = socket.trackMessages();
    await socket.connect();

    await socket.send({ type: 'unsubscribe', id: '1' });

    server.send({ type: 'ready', id: '1' });

    expect(tracker.data).toHaveLength(1);
    expect(tracker.data[0]).toEqual({ type: 'unsubscribe', id: '1' });
  });
});

describe('isServerMessage type guard', () => {
  it('rejects messages with invalid type', () => {
    expect(isServerMessage({ type: 'totally-bogus' })).toBe(false);
  });

  it('accepts ready messages with required fields', () => {
    expect(isServerMessage({ type: 'ready', id: '1' })).toBe(true);
  });

  it('rejects ready messages without id', () => {
    expect(isServerMessage({ type: 'ready' })).toBe(false);
  });

  it('accepts added messages with required fields', () => {
    expect(
      isServerMessage({
        type: 'added',
        collection: 'todos',
        id: '1',
      }),
    ).toBe(true);
  });

  it('accepts added messages with optional fields', () => {
    expect(
      isServerMessage({
        type: 'added',
        collection: 'todos',
        id: '1',
        fields: { text: 'hello' },
      }),
    ).toBe(true);
  });

  it('rejects added messages without collection', () => {
    expect(isServerMessage({ type: 'added', id: '1' })).toBe(false);
  });

  it('rejects added messages without id', () => {
    expect(isServerMessage({ type: 'added', collection: 'todos' })).toBe(false);
  });

  it('accepts changed messages with required fields', () => {
    expect(
      isServerMessage({
        type: 'changed',
        collection: 'todos',
        id: '1',
      }),
    ).toBe(true);
  });

  it('rejects changed messages without collection', () => {
    expect(isServerMessage({ type: 'changed', id: '1' })).toBe(false);
  });

  it('accepts removed messages with required fields', () => {
    expect(
      isServerMessage({
        type: 'removed',
        collection: 'todos',
        id: '1',
      }),
    ).toBe(true);
  });

  it('rejects removed messages without collection', () => {
    expect(isServerMessage({ type: 'removed', id: '1' })).toBe(false);
  });

  it('accepts result messages with required fields', () => {
    expect(
      isServerMessage({
        type: 'result',
        id: '1',
        result: 42,
      }),
    ).toBe(true);
  });

  it('rejects result messages without id', () => {
    expect(isServerMessage({ type: 'result', result: 42 })).toBe(false);
  });

  it('accepts error messages with valid error object', () => {
    expect(
      isServerMessage({
        type: 'error',
        id: '1',
        error: { code: 400, message: 'Bad request' },
      }),
    ).toBe(true);
  });

  it('accepts error messages with error details', () => {
    expect(
      isServerMessage({
        type: 'error',
        id: '1',
        error: { code: 500, message: 'Server error', details: { stack: '...' } },
      }),
    ).toBe(true);
  });

  it('rejects error messages without error object', () => {
    expect(isServerMessage({ type: 'error', id: '1' })).toBe(false);
  });

  it('rejects error messages with invalid error.code', () => {
    expect(
      isServerMessage({
        type: 'error',
        id: '1',
        error: { code: 'not-a-number', message: 'Bad request' },
      }),
    ).toBe(false);
  });

  it('rejects error messages with invalid error.message', () => {
    expect(
      isServerMessage({
        type: 'error',
        id: '1',
        error: { code: 400, message: 123 },
      }),
    ).toBe(false);
  });

  it('rejects non-object data', () => {
    expect(isServerMessage('not an object')).toBe(false);
    expect(isServerMessage(123)).toBe(false);
    expect(isServerMessage(null)).toBe(false);
    expect(isServerMessage(undefined)).toBe(false);
  });

  it('rejects objects without type', () => {
    expect(isServerMessage({ id: '1' })).toBe(false);
  });
});
