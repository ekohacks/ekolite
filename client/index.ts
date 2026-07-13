// Public browser client surface for the `ekolite/client` entry: open a socket to an
// EkoLite server, subscribe to its publications, and hold the streamed documents in a
// reactive store. The heartbeat, stubbed server and other internals stay unexported
// until a consumer shows a need for them.
export { ConnectionManager, type SubscriptionHandle } from './connectionManager.ts';
export { ReactiveStore } from './reactiveStore.ts';
export { ClientSocketWrapper, type WebSocketLike } from './clientSocket.ts';
