import { describe, expect, it } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';
import { MethodMsg } from '../../shared/protocol.ts';
import { RpcError } from '../../shared/types.ts';

describe('ClientSocketWrapper call', () => {
  it('sends method message to the server when connectionManager.call is used', async () => {
    const socket = ClientSocketWrapper.createNull();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();
    const server = socket.simulateServer();
    await socket.connect();

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
    await socket.connect();

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

    await expect(result).rejects.toMatchObject({
      code: 404,
      message: 'Method not found: nope',
    });
  });

  it('rejects an in-flight call when the connection closes', async () => {
    const socket = ClientSocketWrapper.createNull();
    const manager = new ConnectionManager(socket);
    const server = socket.simulateServer();
    await socket.connect();

    // A call whose reply will never come, because the socket drops first.
    const result = manager.call('slow');

    // Dropping the connection rejects the call via the onClose listener.
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

  it('rejects method calls with RpcError preserving the server error', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();
    await socket.connect();

    const call = manager.call('missingMethod');

    const sent = messages.data[0] as MethodMsg;

    server.send({
      type: 'error',
      id: sent.id,
      error: {
        code: 404,
        message: 'Method not found: missingMethod',
      },
    });

    await expect(call).rejects.toMatchObject({
      code: 404,
      message: 'Method not found: missingMethod',
    });

    await expect(call).rejects.toBeInstanceOf(RpcError);
  });
});
