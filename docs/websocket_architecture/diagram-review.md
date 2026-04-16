# Architecture Diagrams Review

Quick rundown of what was wrong with the original diagrams and what the rewrite covers.

## What was wrong

### ER Diagram

The original had snake_case method names everywhere (`send_message`, `broadcast_message`, `simulate_connection`) but the actual code uses camelCase (`send`, `broadcast`, `simulateConnection`). Anyone reading the diagram and then opening the code would be confused.

There was a phantom `WEBSOCKET_CONNECTION` entity that straight up does not exist in the codebase. The real and Fastify backends just store raw `WebSocket` objects from the `ws` library in a `Map<string, WebSocket>`. No wrapper class around individual connections.

`FastifyWebSocketServer` was missing entirely. That is one of three implementations of `WebSocketServerInterface` and it is the one used in production. Pretty important to show.

The client side (`ClientSocket`, `RealClientSocket`, `StubbedClientSocket`) was nowhere to be found. The protocol types from `shared/protocol.ts` were also missing, which is the whole point of the websocket, the messages that flow over it.

Field types were all listed as `string` regardless of what they actually are.

### Flowchart

The original showed a linear chain: `client -> fastify -> wrapper`. That is not how the code works. The Fastify server startup and the WebSocketWrapper are separate concerns. `websocketRoutes.ts` registers the plugin and route. `FastifyWebSocketServer` takes a Fastify instance and sets up its own handler via `start()`. The diagram made it look like one clean pipeline when it is actually two paths that meet at the Fastify instance.

No client side shown at all.

### Sequence Diagram

The original showed message routing logic (wrapper receiving notifications, routing responses, broadcasting) that does not exist yet. Story 3.A has not started. The diagram presented aspirational behaviour as if it was already built without any labelling to say so.

## What the rewrite covers

### ER Diagram

Every entity matches an actual class in the code with correct camelCase names and accurate types.

Server side shows:

- `FASTIFY_SERVER` and `WEBSOCKET_ROUTES_PLUGIN` (the startup and plugin layer)
- `WEBSOCKET_WRAPPER` facade with all three implementations (`FastifyWebSocketServer`, `RealWebSocketServer`, `StubbedWebSocketServer`)
- `STUBBED_CLIENT` test helper

Client side shows:

- `CLIENT_SOCKET` facade with both implementations (`RealClientSocket`, `StubbedClientSocket`)
- `STUBBED_SERVER` test helper

Infrastructure shows `EVENT_EMITTER` and `OUTPUT_TRACKER` for test observability.

Protocol section shows `CLIENT_MESSAGE` (subscribe, unsubscribe, method) and `SERVER_MESSAGE` (ready, data, result, error) with their actual fields from `shared/protocol.ts`.

### Flowchart

Split into four clear sections:

1. **Server Side** with startup flow (start.ts -> createServer -> plugins) separate from the WebSocketWrapper facade and its three branches
2. **Client Side** with ClientSocket facade and its two branches
3. **Shared Protocol** showing the message types
4. **Test Observability** showing EventEmitter -> OutputTracker pattern

The connection between `RealClientSocket` and the `/ws` route is shown as the actual WebSocket link between client and server.

### Sequence Diagram

Four separate diagrams, each clearly labelled:

1. **Implemented: Server startup and connection lifecycle** covers createServer, plugin registration, client connecting via WebSocket, send/receive, and disconnect. All of this works today.

2. **Implemented: Stubbed testing flow (server side)** covers createNull, simulateConnection, how events flow through EventEmitter to OutputTracker. This is how the nullable tests work.

3. **Implemented: Stubbed testing flow (client side)** covers createNull, simulateServer, how the client stub sends and receives messages.

4. **Planned: Message handling (Story 3.A)** covers subscribe/unsubscribe, initial data load, live change push, method calls with result/error responses. Explicitly labelled as not yet implemented so nobody mistakes it for working code.

## Source files referenced

| Diagram entity                       | Actual source                             |
| ------------------------------------ | ----------------------------------------- |
| FASTIFY_SERVER                       | `server/index.ts`                         |
| WEBSOCKET_ROUTES_PLUGIN              | `server/plugins/websocketRoutes.ts`       |
| WebSocketWrapper + 3 implementations | `server/infrastructure/websocket.ts`      |
| ClientSocket + 2 implementations     | `client/clientSocket.ts`                  |
| EventEmitter, OutputTracker          | `server/infrastructure/output_tracker.ts` |
| ClientMessage, ServerMessage         | `shared/protocol.ts`                      |
