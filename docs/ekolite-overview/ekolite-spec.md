# ekolite Specification

Start with [ekolite-overview.md](ekolite-overview.md) for the big picture. This is the API and type reference for EkoLite.

---

## Feature Set

### 1. HTTP Server — Fastify

- **Fastify** as the HTTP server (2-3x faster throughput than Express)
- Built-in JSON schema validation for routes
- Plugin architecture — each feature (uploads, methods, websocket) is a Fastify plugin
- Serves the built client app via `@fastify/static`
- Proxied by Vite in development

### 2. Mini-DDP — WebSocket Pub/Sub + RPC

A stripped-down version of DDP that keeps only pub/sub and RPC. No merge box, no latency compensation, no reconnect replay, no session tracking.

- `@fastify/websocket` plugin (wraps `ws` under the hood)
- Server defines **publications**: named functions that return MongoDB queries
- Client **subscribes** by publication name
- Server uses MongoDB **change streams** to push insert/update/remove events
- Client maintains a local **reactive store** (plain TS, framework-agnostic)
- Store emits events on changes — any UI layer can listen

#### 6 message types (vs ~15 in full DDP):

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

#### Server API:

```ts
definePublication('UserFiles.all', (): FindCursor<UserFile> => {
  return UserFiles.find({});
});
```

#### Client API:

> Built reference: the client pub/sub surface that exists today is documented in
> [`docs/api/`](../api/connection-manager.md) (`ConnectionManager`,
> `SubscriptionHandle`). The snippet below is the spec's target shape, not the
> current API.

```ts
const sub = MeteorLight.subscribe('UserFiles.all');

sub.on('ready', () => {
  /* initial data loaded */
});

const store = MeteorLight.collection<UserFile>('UserFiles');

store.on('change', (docs: UserFile[]) => {
  // update DOM, render chart, whatever — framework-agnostic
});

store.getAll(); // UserFile[]
store.getById(id); // UserFile | undefined
```

### 3. RPC Methods

- Server defines named async methods with typed parameters and return values
- Client calls them over WebSocket or Fastify HTTP POST route
- Structured error responses (code + message + details)
- No retry queue, no optimistic UI — just request/response

#### Server API:

```ts
defineMethod('runCountC', async (targetPath: string): Promise<string> => {
  const scriptPath = resolveAsset('scripts/countC.py');
  const result = await execScript('python3', [scriptPath, targetPath]);
  return result.stdout;
});
```

#### Client API:

```ts
const output: string = await MeteorLight.call<string>('runCountC', '/path/to/uploads');
```

### 4. MongoDB Wrapper

- Thin wrapper around the official `mongodb` Node.js driver
- `defineCollection<T>(name)` returns a typed object with `find`, `findOne`, `insert`, `update`, `remove`
- Server-side only — no Minimongo on the client
- Client gets data through the reactive store (fed by subscriptions)
- Change streams power the pub/sub system

#### Server API:

```ts
interface UserFile {
  _id?: string;
  name: string;
  path: string;
  size: number;
  uploadedAt: Date;
}

const UserFiles = defineCollection<UserFile>('UserFiles');
await UserFiles.insert({
  name: 'sample.bam',
  path: '/uploads/sample.bam',
  size: 1024,
  uploadedAt: new Date(),
});
const files: UserFile[] = await UserFiles.find({});
```

### 5. File Upload Handler

- `@fastify/multipart` for file upload handling (`POST /api/upload`)
- File type validation (configurable allowed extensions)
- Storage to configurable disk path
- Metadata stored in MongoDB (original name, path, size, upload date)
- `onBeforeUpload` validation hook
- `onAfterUpload` processing hook (rename, move, etc.)
- Progress tracking via WebSocket events

#### Server API:

```ts
defineUploadHandler({
  collection: 'UserFiles',
  storagePath: './uploads',
  allowedExtensions: ['bam'],
  onBeforeUpload: (file: UploadMeta): boolean => {
    /* validate */ return true;
  },
  onAfterUpload: (file: StoredFile): void => {
    /* rename, update metadata */
  },
});
```

#### Client API:

```ts
const upload = MeteorLight.upload('/api/upload', fileInput.files[0]);

upload.on('progress', (pct: number) => {
  /* update progress bar */
});
upload.on('complete', (file: StoredFile) => {
  /* handle success */
});
upload.on('error', (err: MeteorLightError) => {
  /* handle failure */
});
```

### 6. Asset Path Resolver

- Simple utility that resolves paths relative to a `private/` directory
- Used for server-side scripts and static data files

```ts
const scriptPath: string = resolveAsset('scripts/countC.py');
// => /absolute/path/to/private/scripts/countC.py
```

---

## Type Definitions (shared/types.ts)

```ts
export interface MeteorLightError {
  code: number;
  message: string;
  details?: unknown;
}

export interface UploadMeta {
  name: string;
  size: number;
  type: string;
  extension: string;
}

export interface StoredFile {
  _id: string;
  name: string;
  path: string;
  size: number;
  extension: string;
  uploadedAt: Date;
  meta?: Record<string, unknown>;
}

export interface SubscribeMsg {
  type: 'subscribe';
  id: string;
  name: string;
  params?: Record<string, unknown>;
}

export interface UnsubscribeMsg {
  type: 'unsubscribe';
  id: string;
}

export interface MethodMsg {
  type: 'method';
  id: string;
  name: string;
  params: unknown[];
}

export interface ReadyMsg {
  type: 'ready';
  id: string;
}

export interface DataMsg {
  type: 'added' | 'changed' | 'removed';
  collection: string;
  id: string;
  fields?: Record<string, unknown>;
}

export interface ResultMsg {
  type: 'result';
  id: string;
  result: unknown;
}

export interface ErrorMsg {
  type: 'error';
  id: string;
  error: MeteorLightError;
}

export type ClientMessage = SubscribeMsg | UnsubscribeMsg | MethodMsg;
export type ServerMessage = ReadyMsg | DataMsg | ResultMsg | ErrorMsg;
```
