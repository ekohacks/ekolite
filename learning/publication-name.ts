// Run me:  npx tsx learning/publication-name.ts
//
// Before you run: write down, out loud or on paper, what you expect
// `store('files')` to hold at the end. Commit to a guess. Then run it.

import { ClientSocketWrapper } from '../client/clientSocket.ts';
import { ConnectionManager } from '../client/connectionManager.ts';
import { SubscribeMsg } from '../shared/protocol.ts';

async function main(): Promise<void> {
  const socket = ClientSocketWrapper.createNull();
  const server = socket.simulateServer();
  const manager = new ConnectionManager(socket);
  const messages = socket.trackMessages();

  // The most natural thing a dev would write: name the publication for what
  // it means, not for where the data is stored.
  const handle = manager.subscribe('files.recent');
  const subId = (messages.data[0] as SubscribeMsg).id;

  // The server does its job: it sends a real document, stamped with the
  // collection that document actually lives in.
  server.send({ type: 'added', collection: 'files', id: 'f1', fields: { name: 'report.bam' } });
  server.send({ type: 'ready', id: subId, collection: 'files' });

  await handle.ready;

  console.log('1. handle.ready resolved        ->', 'no error, no warning');
  console.log('2. the server sent us           ->', 'collection "files", doc f1 = report.bam');
  console.log('3. store("files").getById("f1") ->', manager.store('files').getById('f1'));
}

await main();
