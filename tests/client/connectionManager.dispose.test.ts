import { describe, expect, it } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';

describe('ConnectionManager — after dispose', () => {
  it('store() throws', () => {
    const socket = ClientSocketWrapper.createNull();
    const manager = new ConnectionManager(socket);
    manager.dispose();
    expect(() => manager.store('files')).toThrow();
  });

  it('subscribe() throws', () => {
    const socket = ClientSocketWrapper.createNull();
    const manager = new ConnectionManager(socket);
    manager.dispose();
    expect(() => manager.subscribe('files.all')).toThrow();
  });
});
