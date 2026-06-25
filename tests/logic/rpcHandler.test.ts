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
});
