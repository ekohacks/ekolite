import { expect, it, vi } from 'vitest';
import type { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

// The behaviour every WebSocketWrapper must honour, real or null (observatory ADR 0023,
// rule three). The unit file runs this list on createNull() with simulated clients; the
// integration suite runs it on a raw ws server and on a Fastify one, with real clients
// over real sockets. Timing is the only difference, so every expectation waits. If the
// sides disagree, one of these fails.
export interface ContractClient {
  readonly messages: unknown[];
  send: (message: unknown) => void;
  close: () => Promise<void>;
}

export interface WebSocketFixture {
  ws: WebSocketWrapper;
  connect: () => Promise<ContractClient>;
  close: () => Promise<void>;
}

export type MakeWebSocket = () => Promise<WebSocketFixture>;

const clientIds = (data: unknown[]): string[] =>
  data.map((entry) => (entry as { clientId: string }).clientId);

export function webSocketContract(make: MakeWebSocket): void {
  const using = async (work: (fixture: WebSocketFixture) => Promise<void>): Promise<void> => {
    const fixture = await make();
    try {
      await work(fixture);
    } finally {
      await fixture.close();
    }
  };

  it('counts connected clients as they come and go', async () => {
    await using(async ({ ws, connect }) => {
      expect(ws.clientCount).toBe(0);

      const client = await connect();
      await vi.waitFor(() => {
        expect(ws.clientCount).toBe(1);
      });

      await client.close();
      await vi.waitFor(() => {
        expect(ws.clientCount).toBe(0);
      });
    });
  });

  it('tracks a connection with the client id, and the disconnection with the same id, once', async () => {
    await using(async ({ ws, connect }) => {
      const connections = ws.trackConnections();
      const disconnections = ws.trackDisconnections();
      const disconnected: string[] = [];
      ws.onDisconnect((id) => disconnected.push(id));

      const client = await connect();
      await vi.waitFor(() => {
        expect(connections.data).toHaveLength(1);
      });
      const [id] = clientIds(connections.data);
      await client.close();
      await vi.waitFor(() => {
        expect(clientIds(disconnections.data)).toEqual([id]);
      });

      expect(disconnected).toEqual([id]);
    });
  });

  it('sends a message to one client and no other', async () => {
    await using(async ({ ws, connect }) => {
      const connections = ws.trackConnections();
      const client1 = await connect();
      const client2 = await connect();
      await vi.waitFor(() => {
        expect(connections.data).toHaveLength(2);
      });
      const [id1] = clientIds(connections.data);

      ws.send(id1, { type: 'hello' });

      await vi.waitFor(() => {
        expect(client1.messages).toEqual([{ type: 'hello' }]);
      });
      expect(client2.messages).toEqual([]);
    });
  });

  it('broadcasts a message to every client', async () => {
    await using(async ({ ws, connect }) => {
      const client1 = await connect();
      const client2 = await connect();
      await vi.waitFor(() => {
        expect(ws.clientCount).toBe(2);
      });

      ws.broadcast({ type: 'update', payload: 'refresh' });

      await vi.waitFor(() => {
        expect(client1.messages).toEqual([{ type: 'update', payload: 'refresh' }]);
        expect(client2.messages).toEqual([{ type: 'update', payload: 'refresh' }]);
      });
    });
  });

  it('tracks a message a client sends, with the id of the client that sent it', async () => {
    await using(async ({ ws, connect }) => {
      const connections = ws.trackConnections();
      const messages = ws.trackMessages();
      const client = await connect();
      await vi.waitFor(() => {
        expect(connections.data).toHaveLength(1);
      });
      const [id] = clientIds(connections.data);

      client.send({ type: 'ping' });

      await vi.waitFor(() => {
        expect(messages.data).toEqual([{ clientId: id, message: { type: 'ping' } }]);
      });
    });
  });

  it('refuses to send or broadcast undefined, with a clear message', async () => {
    await using(async ({ ws, connect }) => {
      const connections = ws.trackConnections();
      await connect();
      await vi.waitFor(() => {
        expect(connections.data).toHaveLength(1);
      });
      const [id] = clientIds(connections.data);

      expect(() => {
        ws.send(id, undefined);
      }).toThrow('Cannot send undefined message to client');
      expect(() => {
        ws.broadcast(undefined);
      }).toThrow('Cannot broadcast undefined message to clients');
    });
  });
}
