import { describe, expect, it } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';

// The null socket has to behave like the real WebSocket it stands in for. A
// real WebSocket.send() throws InvalidStateError while the socket is still
// CONNECTING; a no-op null hides that, which is exactly how subscribing before
// the socket opened stayed green in the suite while it threw in a browser. So
// the null throws too, and any code that sends before open is caught here
// rather than in production.
describe('ClientSocketWrapper — sending before the socket opens', () => {
  it('throws InvalidStateError, like a real WebSocket that is still connecting', () => {
    const socket = ClientSocketWrapper.createNull();

    let thrown: unknown;
    try {
      void socket.send({ type: 'ping' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DOMException);
    expect((thrown as DOMException).name).toBe('InvalidStateError');
  });

  it('sends without throwing once the socket is open', async () => {
    const socket = ClientSocketWrapper.createNull();
    await socket.connect();

    expect(() => {
      void socket.send({ type: 'ping' });
    }).not.toThrow();
  });
});
