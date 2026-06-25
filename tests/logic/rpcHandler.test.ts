import { describe, expect, it } from 'vitest';
import { Methods } from '../../server/logic/methods.ts';
import { RpcHandler } from '../../server/logic/rpcHandler.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

describe('RpcHandler', () => {
  it('runs a named method and sends the result back to the caller', async () => {
    const ws = WebSocketWrapper.createNull();
    const methods = new Methods();
    methods.define('echo', (msg) => Promise.resolve(`echo: ${String(msg)}`));
    const rpc = new RpcHandler(methods, ws);
    const client = ws.simulateConnection();

    await rpc.handleMessage(client.id, {
      type: 'method',
      id: 'm1',
      name: 'echo',
      params: ['hello'],
    });

    expect(client.messages).toContainEqual({
      type: 'result',
      id: 'm1',
      result: 'echo: hello',
    });
  });

  it('throws a structured 404 for unknown method', async () => {
    const ws = WebSocketWrapper.createNull();
    const rpc = new RpcHandler(new Methods(), ws);
    const client = ws.simulateConnection();

    await rpc.handleMessage(client.id, {
      type: 'method',
      id: 'm1',
      name: 'nope',
      params: [],
    });

    expect(client.messages).toContainEqual({
      type: 'error',
      id: 'm1',
      error: { code: 404, message: 'Method not found: nope' },
    });
  });

  it('normalizes unexpected method errors to a 500 EkoLiteError', async () => {
    const ws = WebSocketWrapper.createNull();
    const methods = new Methods();

    methods.define('explode', () => {
      throw new Error('Something went wrong');
    });

    const rpc = new RpcHandler(methods, ws);
    const client = ws.simulateConnection();

    await rpc.handleMessage(client.id, {
      type: 'method',
      id: 'm1',
      name: 'explode',
      params: [],
    });

    expect(client.messages).toContainEqual({
      type: 'error',
      id: 'm1',
      error: {
        code: 500,
        message: 'Something went wrong',
      },
    });
  });
});
