# ekolite

A lightweight, real-time backend framework for data-driven apps. Fastify + MongoDB + WebSocket with typed pub/sub, RPC methods, and file uploads. ~820 lines, zero UI opinions.

## Features

- **Fastify** HTTP server with plugin architecture
- **Mini-DDP** — WebSocket pub/sub + RPC with 6 message types
- **MongoDB wrapper** with change streams for real-time updates
- **Reactive store** — framework-agnostic client-side data store
- **File uploads** via `@fastify/multipart` with progress tracking and validation
- **Asset resolver** for server-side scripts and data files
- **TypeScript** end-to-end with shared types between server and client
- **Vite** for sub-100ms HMR in development

## Quick Start

```bash
# Install dependencies
npm install

# Start development (two terminals)
npm run dev:server   # Fastify with auto-restart
npm run dev:client   # Vite with HMR

# Type check
npm run typecheck

# Run tests
npm test
```

## Project Structure

```
ekolite/
├── server/
│   ├── index.ts                # App class — wires everything
│   ├── infrastructure/
│   │   ├── mongo.ts            # MongoWrapper + Null
│   │   ├── websocket.ts        # WebSocketServer + Null
│   │   ├── fileStorage.ts      # FileStorage + Null
│   │   └── scriptRunner.ts     # ScriptRunner + Null
│   └── logic/
│       ├── publications.ts     # Pub/sub logic
│       ├── methods.ts          # RPC method registry
│       ├── rpcHandler.ts       # Routes WS messages to methods
│       └── uploadHandler.ts    # File upload logic
├── client/
│   ├── connection.ts           # WebSocket connection manager
│   ├── store.ts                # ReactiveStore
│   ├── subscribe.ts            # Subscribe to publications
│   ├── call.ts                 # RPC method caller
│   └── upload.ts               # File upload with progress
├── shared/
│   ├── protocol.ts             # Mini-DDP message types
│   └── types.ts                # Shared type definitions
├── tests/
│   ├── infrastructure/         # Narrow integration tests (real systems)
│   ├── logic/                  # Sociable tests (Nulled infrastructure)
│   └── client/                 # Client-side tests
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Server API

### Collections

```ts
const UserFiles = defineCollection<UserFile>('UserFiles');
await UserFiles.insert({
  name: 'sample.bam',
  path: '/uploads/sample.bam',
  size: 1024,
  uploadedAt: new Date(),
});
const files = await UserFiles.find({});
```

### Publications

```ts
definePublication('UserFiles.all', (): FindCursor<UserFile> => {
  return UserFiles.find({});
});
```

### Methods

```ts
defineMethod('runCountC', async (targetPath: string): Promise<string> => {
  const scriptPath = resolveAsset('scripts/countC.py');
  const result = await execScript('python3', [scriptPath, targetPath]);
  return result.stdout;
});
```

### File Uploads

```ts
defineUploadHandler({
  collection: 'UserFiles',
  storagePath: './uploads',
  allowedExtensions: ['bam'],
  onBeforeUpload: (file) => true,
  onAfterUpload: (file) => {
    /* post-processing */
  },
});
```

## Client API

### Subscribe

```ts
const sub = MeteorLight.subscribe('UserFiles.all');
sub.on('ready', () => {
  /* initial data loaded */
});

const store = MeteorLight.collection<UserFile>('UserFiles');
store.on('change', (docs) => {
  /* update UI */
});
store.getAll();
store.getById(id);
```

### Call Methods

```ts
const result = await MeteorLight.call<string>('runCountC', '/path/to/uploads');
```

### Upload Files

```ts
const upload = MeteorLight.upload('/api/upload', file);
upload.on('progress', (pct) => {
  /* update progress bar */
});
upload.on('complete', (file) => {
  /* done */
});
upload.on('error', (err) => {
  /* handle failure */
});
```

## Mini-DDP Protocol

6 message types (vs ~15 in full DDP):

```
Client → Server:
  { type: 'subscribe', id, name, params }
  { type: 'unsubscribe', id }
  { type: 'method', id, name, params }

Server → Client:
  { type: 'ready', id }
  { type: 'added' | 'changed' | 'removed', collection, id, fields }
  { type: 'result' | 'error', id, result | error }
```

## Testing

Built with **Testing Without Mocks** (Nullable pattern). Every infrastructure wrapper has `create()` and `createNull()` factories. No mock libraries needed — just vitest.

```bash
npm test                  # All tests
npm run test:watch        # Fast tests on every save (logic + client)
npm run test:integration  # Narrow integration tests (real MongoDB, real fs)
```

## Production Build

```bash
npm run build   # tsc + vite build
npm start       # node dist/server/index.js
```

## Dependencies

**Runtime (5):** fastify, @fastify/websocket, @fastify/multipart, @fastify/static, mongodb

**Dev (4):** vite, typescript, tsx, vitest

## License

## Architecture diagrams

This project includes Mermaid diagrams to make the websocket architecture easier to understand visually.

Why this exists:

- code shows implementation details
- diagrams show structure and flow
- humans understand visual relationships faster than raw code alone

The diagrams help explain:

- how the client reaches the websocket layer
- how Fastify, the wrapper, and backend implementations relate
- how message flow works from connection to disconnect
- how test doubles fit into the system

### Diagram types

- **ERD**: shows structural relationships between the main parts
- **Flowchart**: shows the high-level runtime path
- **Sequence diagram**: shows message flow step by step

### How to view in VS Code

1. Install the extension:
   - `Markdown Preview Mermaid Support`

2. Create or open a `.md` file containing a Mermaid code block.

3. Open markdown preview:
   - `Ctrl + Shift + V`

### Example

````
```mermaid
flowchart LR
    client["Client App"] --> fastify["Fastify Server"]
    fastify --> wrapper["WebSocket Wrapper"]
````

````

### Notes

- Mermaid diagrams must be inside a fenced block starting with ` ```mermaid `
- The opening and closing backticks must be on their own lines
- If a diagram does not render, first confirm it works with a tiny test diagram

## My exprience
I had blocker markdown extention that didnt allow my diagrams to show so
- Solution
I searched "mermaid" and deleted all related extentions
I searched "markedown" and deleted all related extentions
I left only
-  `Markdown Preview Mermaid Support`

### Why this matters

This architecture has multiple layers and interchangeable implementations.
Visual diagrams make it easier to:
- reason about the system
- explain it to new contributors
- spot incorrect assumptions early
- keep implementation and design aligned
````
