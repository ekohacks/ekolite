import { ClientSocketWrapper } from '../../../client/clientSocket.ts';
import { ConnectionManager } from '../../../client/connectionManager.ts';

// A stand-in for whatever paints your UI. Declared so the example compiles
// without pulling in a framework.
declare function render(files: unknown[]): void;

const socket = ClientSocketWrapper.create('wss://app.example/ws');
await socket.connect();
const manager = new ConnectionManager(socket);

const handle = manager.subscribe('files.byFolder', { folderId: 'folder-a' });
await handle.ready;

const files = manager.store('files');
render(files.getAll()); // initial paint: the docs that arrived before ready
files.onChange(() => {
  render(files.getAll()); // subsequent live updates
});

// On unmount:
handle.stop();
