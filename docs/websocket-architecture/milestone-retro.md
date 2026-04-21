# EkoLite Milestone: What We Have Built

This branch (`EKO-266`) is being merged into main. Here is what exists, what it does, and what comes next.

## What is EkoLite

EkoLite is a lightweight real time web framework. Think of it as a stripped down Meteor replacement. It gives you a server, a client, a WebSocket connection between them, and a protocol for sending messages back and forth.

The end goal is a genomics file management app where users upload files, run analysis scripts, and see live results. But right now we have built the transport layer, not the application.

## What you can do with it right now

The most tangible thing you can do is spin up a server, connect a client, and see them talk to each other.

### Start the server

```bash
npm run dev
```

This runs `server/start.ts` which calls `createServer()` and listens on port 3001. The server:

1. Registers `@fastify/static` to serve the built client files
2. Registers the `websocketRoutes` plugin which sets up `@fastify/websocket` and creates a `/ws` route

### Open the client

Visit `http://localhost:3001` in a browser. The client code in `client/main.ts`:

1. Detects whether you are on http or https
2. Builds a WebSocket URL (`ws://localhost:3001/ws`)
3. Creates a `ClientSocketWrapper` and calls `connect()`
4. Updates the page to show "Connection: ON" when the WebSocket opens

That is the full working flow end to end. Server starts, client loads, WebSocket connects.

### What happens under the hood

When the client connects, the `FastifyWebSocket` (inside the `WebSocketWrapper`):

1. Assigns the connection an ID (incrementing from 0)
2. Stores the raw WebSocket in a `Map<string, WebSocket>`
3. Listens for the close event to clean up

The server can now `send(clientId, message)` to one client or `broadcast(message)` to all of them.

## The infrastructure layer

We have built five infrastructure wrappers. Each one follows the same pattern:

- A **facade class** with static factory methods (`create()` for production, `createNull()` for testing)
- A **real implementation** that talks to the actual external system
- A **stubbed implementation** that works entirely in memory for tests

| Wrapper               | What it wraps         | Production use                        | Test use              |
| --------------------- | --------------------- | ------------------------------------- | --------------------- |
| `WebSocketWrapper`    | WebSocket connections | `FastifyWebSocket` or `RealWebSocket` | `StubbedWebSocket`    |
| `MongoWrapper`        | MongoDB database      | `RealMongo`                           | `StubbedMongo`        |
| `FileStorageWrapper`  | File system           | `RealFileStorage`                     | `StubbedFileStorage`  |
| `ScriptRunnerWrapper` | Shell commands        | `RealScriptRunner`                    | `StubbedScriptRunner` |
| `ClientSocketWrapper` | Browser WebSocket     | `RealClientSocket`                    | `StubbedClientSocket` |

The key idea: **no mocks**. Instead of mocking external dependencies in tests, we use the `createNull()` factory to get a fully functional in memory version. Tests run fast, they are deterministic, and they test real behaviour rather than mock expectations.

### Test observability

The stubbed implementations use an `EventEmitter` and `OutputTracker` system so tests can observe what happened without mocking:

```typescript
const ws = WebSocketWrapper.createNull();
const connections = ws.trackConnections();

const client = ws.simulateConnection();

// connections.data now contains [{ clientId: '0' }]
```

No spies, no mocks, no `expect(x).toHaveBeenCalledWith()`. You just read the data.

## The protocol

`shared/protocol.ts` defines six message types that will flow over the WebSocket.

**Client to server:**

- `subscribe` with a publication name and params
- `unsubscribe` to stop receiving updates
- `method` to call a server function (RPC)

**Server to client:**

- `ready` to confirm a subscription is set up
- `added` / `changed` / `removed` for live data updates
- `result` / `error` for method call responses

These types are defined and the client is typed to send `ClientMessage` and receive `ServerMessage`. But **nothing on the server reads or responds to these messages yet**. That is Story 3.A.

## File map

Where everything lives:

```
server/
  index.ts                        → createServer() factory
  start.ts                        → bootstrap, listens on port 3001
  plugins/
    websocketRoutes.ts            → registers @fastify/websocket and /ws route
  infrastructure/
    websocket.ts                  → WebSocketWrapper + 3 implementations
    mongo.ts                      → MongoWrapper + 2 implementations
    fileStorage.ts                → FileStorageWrapper + 2 implementations
    scriptRunner.ts               → ScriptRunnerWrapper + 2 implementations
    outputTracker.ts              → EventEmitter, OutputTracker, ConfigurableResponse

client/
  main.ts                         → browser entry point, connects WebSocket
  clientSocket.ts                 → ClientSocketWrapper + 2 implementations

shared/
  protocol.ts                     → 6 message types (mini DDP)
  types.ts                        → ChangeEvent, ScriptResult, UploadMeta, StoredFile, MethodFn
```

## What is NOT built yet

To be clear about what does not exist:

- No publications (server side queries exposed to clients)
- No method handlers (server functions clients can call)
- No message routing (server does not read incoming WebSocket messages)
- No file upload endpoint
- No MongoDB wired up to the server
- No UI beyond the hello world connection status

## What comes next

**Story 3.A: Server side publications.** This is where the protocol comes alive:

1. Register a publication on the server
2. Client sends a `subscribe` message
3. Server queries MongoDB and sends back `ready` + `added` messages
4. When the database changes, server pushes `changed`/`removed` to subscribers
5. Client sends `unsubscribe` to stop updates

That is the next milestone. Once publications work, EkoLite becomes a real time data framework instead of just a transport layer.
