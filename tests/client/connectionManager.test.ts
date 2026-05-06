import { expect, it } from "vitest";
import { ClientSocketWrapper } from "../../client/clientSocket.ts";
import { SubscribeMsg } from "../../shared/protocol.ts";

it('subscribe sends a subscribe message and routes added documents into the store', async () => {
  const socket = ClientSocketWrapper.createNull();
  const manager = new ConnectionManager(socket);
  const messages = socket.trackMessages();
  const server = socket.simulateServer();

  const handle = manager.subscribe('files.all');

  // Manager sent the subscribe message.
  expect(messages.data).toHaveLength(1);
  const sent = messages.data[0] as SubscribeMsg;
  expect(sent.type).toBe('subscribe');
  expect(sent.name).toBe('files.all');

  // Simulate the server responding.
  server.send({
    type: 'added',
    collection: 'files',
    id: '1',
    fields: { name: 'existing.bam' },
  });
  server.send({ type: 'ready', id: sent.id });

  await handle.ready;

  expect(manager.store('files').getById('1')).toEqual({ _id: '1', name: 'existing.bam' });
});
