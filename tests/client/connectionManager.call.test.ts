import { describe, expect, it } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';
import { MethodMsg } from '../../shared/protocol.ts';

describe('ClientSocketWrapper call', () => {
  it('sends method message to the server when connectionManager.call is used', async () => {
    const socket = ClientSocketWrapper.createNull();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();
    const server = socket.simulateServer();

    const result = manager.call('echo', 'hello');

    const sent = messages.data[0] as MethodMsg;
    expect(sent.type).toBe('method');
    expect(sent.name).toBe('echo');

    server.send({ type: 'result', id: sent.id, result: 'echo: hello' });

    await expect(result).resolves.toBe('echo: hello');
  });

  it('rejects a pending call when an error reply arrives', async () => {
    const socket = ClientSocketWrapper.createNull();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();
    const server = socket.simulateServer();

    const result = manager.call('nope');

    const sent = messages.data[0] as MethodMsg;

    server.send({
      type: 'error',
      id: sent.id,
      error: {
        code: 404,
        message: 'Method not found: nope',
      },
    });

    await expect(result).rejects.toEqual({
      code: 404,
      message: 'Method not found: nope',
    });
  });
});
