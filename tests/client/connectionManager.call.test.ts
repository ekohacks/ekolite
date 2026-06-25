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

  it('rejects an in-flight call when the connection closes', async () => {
    const socket = ClientSocketWrapper.createNull();
    const manager = new ConnectionManager(socket);
    const server = socket.simulateServer();

    // A call whose reply will never come, because the socket drops first.
    const result = manager.call('slow');

    // Dropping the connection runs dispose() via the onClose listener.
    server.simulateClose();

    // The call must settle, not wait forever. Race it against a short timer so
    // a hang fails fast and clearly rather than via the suite timeout. The
    // rejection handler on result keeps a correct rejection from going unhandled.
    const outcome = await Promise.race([
      result.then(
        () => 'resolved',
        () => 'rejected',
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve('pending');
        }, 50);
      }),
    ]);

    expect(outcome).toBe('rejected');
  });
});
