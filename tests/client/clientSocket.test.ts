import { describe, it, expect } from 'vitest';
import { ClientSocket } from '../../client/clientSocket.ts';

describe('ClientSocket (null)', () => {
  it('is not connected before connect is called', () => {
    const socket = ClientSocket.createNull();
    expect(socket.isConnected).toBe(false);
  });
});
