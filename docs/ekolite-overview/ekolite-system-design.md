# ekolite — System Design

Start with [ekolite-overview.md](ekolite-overview.md) for the big picture. This document explains how Meteor works and how every concept maps to EkoLite.

---

## 1. What Is Meteor

Meteor is a full-stack JavaScript framework. You write client and server code in the same project, and the framework handles everything in between: building, bundling, data synchronization, real-time updates, and RPC.

### 1.1 The Meteor Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      METEOR FRAMEWORK                         │
│                                                               │
│  ┌─── CLIENT (browser) ────────┐   ┌─── SERVER (Node.js) ──┐ │
│  │                              │   │                        │ │
│  │  Meteor.startup()            │   │  Meteor.startup()      │ │
│  │  ↓                           │   │  ↓                     │ │
│  │  React renders App           │   │  MongoDB connects      │ │
│  │                              │   │  Publications defined  │ │
│  │  Minimongo ◄── DDP ────────────── Mongo.Collection       │ │
│  │  (in-memory mirror)  (WebSocket)  (real MongoDB)          │ │
│  │                              │   │                        │ │
│  │  Meteor.subscribe() ◄─────────── Meteor.publish()        │ │
│  │  Meteor.call() ◄──────────────── Meteor.methods()        │ │
│  │                              │   │                        │ │
│  │  useTracker() → React re-render  │                        │ │
│  │                              │   │                        │ │
│  │  ostrio:files.insert() ────────── FilesCollection         │ │
│  │  (upload with progress)      │   │  (disk + MongoDB)      │ │
│  │                              │   │                        │ │
│  └──────────────────────────────┘   └────────────────────────┘ │
│                                                               │
│  Build system: Babel + custom bundler + 69 packages            │
└──────────────────────────────────────────────────────────────┘
```

Everything communicates over **DDP** (Distributed Data Protocol) — a WebSocket-based protocol with ~15 message types. You never see the WebSocket directly. Meteor manages connections, reconnection, session tracking, and data merging automatically.

### 1.2 Meteor Concepts — Explained with Our Code

#### Meteor.startup()

Runs your code after the framework is ready.

**Client** (`client/main.jsx`):

```jsx
Meteor.startup(() => {
  const container = document.getElementById('react-target');
  const root = createRoot(container);
  root.render(
    <ChakraProvider>
      <App />
    </ChakraProvider>,
  );
});
```

Waits for: DDP connection established, packages loaded, DOM ready. Then renders React.

**Server** (`server/main.js`):

```js
Meteor.startup(() => {
  console.log('Server started and ready for file uploads.');
});
```

Waits for: MongoDB connected, all server code loaded. Then runs.

#### Collections & Minimongo

Meteor gives you one `Collection` object that works on both client and server. On the server it talks to real MongoDB. On the client it talks to **Minimongo** — an in-memory database that Meteor keeps in sync.

**Our code** (`imports/api/files.js`):

```js
export const UserFiles = new FilesCollection({
  collectionName: 'UserFiles',
  storagePath: 'assets/app/uploads',
  allowClientCode: false,
  onBeforeUpload(file) {
    if (/bam$/i.test(file.extension)) return true;
    return 'Only .bam files are allowed!';
  },
  onAfterUpload(fileObj) {
    // renames file to original name, updates metadata in MongoDB
    const oldPath = fileObj.path;
    const newPath = path.join(path.dirname(oldPath), originalName);
    fs.rename(oldPath, newPath, (err) => { ... });
    UserFiles.collection.updateAsync(fileObj._id, { $set: { ... } });
  }
});
```

`FilesCollection` (from `ostrio:files`) extends the Meteor collection concept with file storage: disk path, validation hooks, metadata tracking.

**How Minimongo sync works:**

```
Server MongoDB  ──── DDP messages ────►  Client Minimongo
     │               (added, changed,         │
     │                removed)                 │
     │                                         ▼
     ▼                                  UserFiles.find({})
UserFiles.find({})                      → instant, from memory
→ from real MongoDB                     → re-renders React via useTracker
```

#### Publish / Subscribe

The server controls what data clients can see. The client requests data by name.

**Server** (`imports/api/files.js`):

```js
Meteor.publish('files.UserFiles.all', function () {
  return UserFiles.find().cursor;
});
```

Defines a **publication**: "anyone who subscribes to `'files.UserFiles.all'` gets all documents from UserFiles."

**Client** (`imports/ui/Home.jsx`):

```jsx
const { files, isLoading } = useTracker(() => {
  const filesHandle = Meteor.subscribe('UserFiles.all');
  const loading = !filesHandle.ready();
  const filesList = UserFiles.find({});
  return { files: filesList, isLoading: loading };
}, []);
```

What happens step by step:

1. `Meteor.subscribe('UserFiles.all')` sends a DDP `sub` message to the server
2. Server runs the publication function, finds matching documents
3. Server sends each document as a DDP `added` message
4. Server sends a `ready` message when done
5. As documents change, server sends `changed`/`removed` messages
6. `useTracker()` re-runs whenever the data changes → React re-renders

```
Client                              Server
  │                                    │
  │── sub('UserFiles.all') ──────────►│
  │                                    │── UserFiles.find().cursor
  │◄── added { _id:'1', name:'a' } ──│
  │◄── added { _id:'2', name:'b' } ──│
  │◄── ready ─────────────────────────│
  │                                    │
  │    (new file uploaded)             │
  │                                    │── change stream detects insert
  │◄── added { _id:'3', name:'c' } ──│
  │                                    │
  │    useTracker re-renders React     │
```

#### Methods / Call (RPC)

The server defines named functions. The client calls them remotely.

**Server** (`imports/api/PythonMethods.js`):

```js
Meteor.methods({
  async runCountC() {
    return new Promise((resolve, reject) => {
      const scriptPath = Assets.absoluteFilePath('scripts/countC.py');
      const targetAbs = path.resolve(buildRoot, 'assets/app/uploads/bam');

      execFile('python3', [scriptPath, targetAbs], (error, stdout, stderr) => {
        if (error) {
          reject(new Meteor.Error('python-failed', stderr || error.message));
          return;
        }
        resolve(String(stdout).trim());
      });
    });
  },
});
```

Key pieces:

- `Meteor.methods({})` registers functions by name
- `Assets.absoluteFilePath()` resolves paths inside the Meteor build output
- `Meteor.Error` is a structured error with a reason code
- `execFile` runs the Python analysis script

**Client** (`imports/ui/GoSubmitButton.jsx`):

```jsx
const handleSubmit = async () => {
  const targetPath = '.meteor/local/build/programs/server/assets/app/uploads/bam';
  const result = await Meteor.callAsync('runCountC', targetPath);
  console.log('Count from Python:', result);
};
```

The client calls `Meteor.callAsync('runCountC', ...)` → DDP sends a `method` message → server runs it → DDP returns a `result` message → Promise resolves.

**Note:** Meteor methods also support **optimistic UI** (run the method on client first for instant feedback, then reconcile with server result). We don't use this feature — our method runs Python, which is server-only.

#### File Uploads (ostrio:files)

**Client** (`imports/ui/BamUploader.jsx`):

```jsx
BamCollection.insert({
  file,
  onBeforeUpload(fileData) {
    const isBam = fileData.extension?.toLowerCase() === 'txt'; // changed for testing
    if (!isBam) return false;
    return true;
  },
  onProgress(currentProgress) {
    setProgress(Math.round(currentProgress));
  },
  onUploaded(error, fileObj) {
    if (error) console.error('Upload error:', error);
    else console.log('Upload complete. File ID:', fileObj._id);
  },
});
```

`ostrio:files` handles the full upload lifecycle:

1. Client-side validation (`onBeforeUpload`)
2. Chunked transfer over DDP or HTTP
3. Server stores file on disk at `storagePath`
4. Server inserts metadata into MongoDB
5. Server runs `onAfterUpload` hook (our app renames the file)
6. Client gets progress updates (`onProgress`)
7. Client gets completion callback (`onUploaded`)

#### DDP — The Wire Protocol

DDP ties everything together. You never write DDP messages in Meteor — the framework does it for you.

**Full DDP has ~15 message types:**

```
connect, connected, ping, pong, sub, unsub, nosub,
added, changed, removed, ready, updated,
method, result, error
```

The important ones for us:

- `sub`/`unsub` — client subscribes/unsubscribes to publications
- `added`/`changed`/`removed` — server pushes data changes to client
- `ready` — server signals initial data is loaded
- `method` — client calls an RPC method
- `result`/`error` — server returns method outcome

#### Build System

Meteor has its own build system:

- Scans `imports/`, `client/`, `server/` directories
- Babel transpiles JSX and modern JS
- Bundles 69 packages (most unused in our app)
- Full rebuild takes seconds
- Hot code push reloads the entire page (not just the changed component)

Our `.meteor/` directory contains the entire build pipeline and package system.

---

## 2. What ekolite Keeps, Simplifies, and Drops

### 2.1 The Decision Table

| Meteor Feature                     | Decision                                                       | Rationale                                                                                              |
| ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| DDP (full protocol, ~15 msg types) | **Simplify** → Mini-DDP (6 msg types)                          | We only use pub/sub and RPC. Drop connect handshake, ping/pong, session tracking, merge box.           |
| Mongo.Collection + Minimongo       | **Simplify** → MongoWrapper + ReactiveStore                    | We don't need client-side queries. A simple Map that responds to server messages is enough.            |
| Meteor.methods / Meteor.call       | **Keep** → Methods.define / MeteorLight.call                   | Same concept, same pattern. Just our code instead of Meteor's.                                         |
| Meteor.publish / Meteor.subscribe  | **Keep** → Publications.define / MeteorLight.subscribe         | Same concept. We use MongoDB change streams instead of Meteor's oplog tailing.                         |
| ostrio:files                       | **Replace** → UploadHandler + FileStorage + @fastify/multipart | ostrio:files is a 3rd party package with complex internals. Standard HTTP multipart upload is simpler. |
| Assets.absoluteFilePath            | **Keep** → resolveAsset()                                      | Same utility, just not tied to Meteor's build output paths.                                            |
| Accounts, Session, ReactiveVar     | **Drop**                                                       | Our app has no auth, no sessions, no reactive variables.                                               |
| Merge box                          | **Drop**                                                       | Merge box deduplicates data across overlapping subscriptions. We have one subscription.                |
| Latency compensation               | **Drop**                                                       | Our methods run Python scripts server-side. Nothing to optimistically simulate on the client.          |
| Reconnect replay                   | **Drop**                                                       | If the connection drops, the client re-subscribes. Simpler than replaying a session log.               |
| Blaze, Tracker autorun             | **Drop**                                                       | We use React. Tracker is Blaze's reactivity system.                                                    |
| Build system (69 packages)         | **Replace** → Vite + tsx + tsc                                 | Meteor's custom bundler is the main source of slowness and complexity.                                 |

### 2.2 The Architecture Comparison

**Before (Meteor):**

```
┌──────────────────────────────┐
│         METEOR               │
│  69 packages                 │
│  Custom bundler              │
│  DDP (~15 msg types)         │
│  Minimongo                   │
│  Merge box                   │
│  Latency compensation        │
│  Session tracking            │
│  ostrio:files                │
│  ~??? lines (framework)      │
└──────────────────────────────┘
```

**After (ekolite):**

```
┌──────────────────────────────┐
│       ekolite           │
│  5 runtime dependencies      │
│  Vite (client build)         │
│  Mini-DDP (6 msg types)      │
│  ReactiveStore (Map)         │
│  No merge box                │
│  No latency compensation     │
│  No sessions                 │
│  @fastify/multipart          │
│  ~820 lines (our code)       │
└──────────────────────────────┘
```

---

## 3. Concept Mapping — Meteor → ekolite

This is the central reference. Every row connects a Meteor concept to our actual code, its ekolite replacement, and where that replacement gets built.

|  #  | Meteor Concept                      | Our Meteor Code                                                        | ekolite Replacement                                            | Where It's Built        |
| :-: | ----------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------- |
|  1  | `Meteor.startup()` (client)         | `client/main.jsx` — renders React after DDP ready                      | Vite entry script — just `import` and run                      | Epic 1, Story 1.A       |
|  2  | `Meteor.startup()` (server)         | `server/main.js` — logs "ready" after Mongo connects                   | `App.create(config)` → `fastify.listen()`                      | Epic 7, Story 7.B       |
|  3  | `Mongo.Collection`                  | `FilesCollection` in `imports/api/files.js`                            | `MongoWrapper` (thin wrapper over `mongodb` driver)            | Smoke Test 0, Story 0.A |
|  4  | Minimongo (client-side mirror)      | Automatic via DDP — `UserFiles.find({})` works on client               | `ReactiveStore` — `Map<id, doc>` fed by server messages        | Epic 3, Story 3.B       |
|  5  | `Meteor.publish()`                  | `Meteor.publish('files.UserFiles.all', ...)` in `imports/api/files.js` | `Publications.define('UserFiles.all', ...)`                    | Epic 3, Story 3.A       |
|  6  | `Meteor.subscribe()`                | `Meteor.subscribe('UserFiles.all')` in `imports/ui/Home.jsx`           | `MeteorLight.subscribe('UserFiles.all')`                       | Epic 3, Story 3.C       |
|  7  | `useTracker()`                      | `useTracker(() => { ... })` in `imports/ui/Home.jsx`                   | `store.on('change', callback)` — UI layer listens to store     | Epic 3, Story 3.B       |
|  8  | `Meteor.methods()`                  | `Meteor.methods({ runCountC() { ... } })` in `PythonMethods.js`        | `Methods.define('runCountC', async (...) => { ... })`          | Epic 4, Story 4.A       |
|  9  | `Meteor.call()` / `callAsync()`     | `Meteor.callAsync('runCountC', targetPath)` in `GoSubmitButton.jsx`    | `MeteorLight.call('runCountC', targetPath)`                    | Epic 4, Story 4.C       |
| 10  | `Meteor.Error`                      | `new Meteor.Error("python-failed", ...)` in `PythonMethods.js`         | `MeteorLightError { code, message, details }`                  | Epic 4, Story 4.A       |
| 11  | `Assets.absoluteFilePath()`         | `Assets.absoluteFilePath("scripts/countC.py")` in `PythonMethods.js`   | `resolveAsset("scripts/countC.py")`                            | Epic 7, Story 7.A       |
| 12  | `execFile` (child_process)          | `execFile("python3", [...])` in `PythonMethods.js`                     | `ScriptRunner.exec("python3", [...])`                          | Smoke Test 0, Story 0.D |
| 13  | `FilesCollection.insert()` (client) | `BamCollection.insert({ file, onProgress, ... })` in `BamUploader.jsx` | `MeteorLight.upload('/api/upload', file)` with progress events | Epic 5, Story 5.D       |
| 14  | `onBeforeUpload`                    | Extension check in `imports/api/files.js`                              | `UploadHandler.validate()`                                     | Epic 5, Story 5.A       |
| 15  | `onAfterUpload`                     | Rename + metadata update in `imports/api/files.js`                     | Post-save logic in `UploadHandler.handle()`                    | Epic 5, Story 5.B       |
| 16  | `onProgress`                        | `setProgress(Math.round(currentProgress))` in `BamUploader.jsx`        | `upload.on('progress', (pct) => { ... })`                      | Epic 5, Story 5.D       |
| 17  | DDP protocol (~15 msg types)        | Invisible — framework handles it                                       | Mini-DDP (6 msg types) in `shared/protocol.ts`                 | Smoke Test 0, Story 0.B |
| 18  | DDP transport (WebSocket)           | Invisible — framework handles it                                       | `WebSocketServer` wrapper                                      | Smoke Test 0, Story 0.B |
| 19  | Build system (Babel + bundler)      | `.meteor/` directory, 69 packages                                      | Vite (client) + tsx (server dev) + tsc (types)                 | Epic 1, Story 1.B       |
| 20  | `React Router`                      | `BrowserRouter` + `Routes` in `App.jsx`                                | Stays the same — ekolite doesn't dictate UI                    | Not in scope            |

---

## 4. Mini-DDP Protocol Design

Full DDP has ~15 message types. We keep 6:

### 4.1 Messages We Keep

```
Client → Server:
  { type: 'subscribe', id, name, params }     ← request data
  { type: 'unsubscribe', id }                 ← stop receiving data
  { type: 'method', id, name, params }        ← call a server function

Server → Client:
  { type: 'ready', id }                       ← initial data loaded
  { type: 'added'|'changed'|'removed',        ← data changed
    collection, id, fields }
  { type: 'result'|'error', id, result|error } ← method response
```

### 4.2 Messages We Drop and Why

| DDP Message             | Purpose                                       | Why We Don't Need It                        |
| ----------------------- | --------------------------------------------- | ------------------------------------------- |
| `connect` / `connected` | Handshake with version negotiation            | WebSocket `open` event is enough            |
| `ping` / `pong`         | Keepalive                                     | The `ws` library handles this natively      |
| `nosub`                 | Subscription rejected                         | We send a regular `error` message           |
| `updated`               | "Method writes have been applied to all subs" | We don't do optimistic UI                   |
| Session IDs             | Track client across reconnects                | Client re-subscribes on reconnect — simpler |

### 4.3 Flow Examples

**Subscribe to file list:**

```
Client                              Server
  │── subscribe(id:'s1',            │
  │     name:'UserFiles.all') ─────►│
  │                                  │── query MongoDB
  │◄── added(collection:'UserFiles', │
  │     id:'1', fields:{name:'a'}) ─│
  │◄── ready(id:'s1') ──────────────│
  │                                  │
  │    [file uploaded by someone]    │
  │                                  │── change stream fires
  │◄── added(collection:'UserFiles', │
  │     id:'2', fields:{name:'b'}) ─│
```

**Call a method:**

```
Client                              Server
  │── method(id:'m1',               │
  │    name:'runCountC',            │
  │    params:['/uploads']) ───────►│
  │                                  │── ScriptRunner.exec('python3', ...)
  │◄── result(id:'m1',              │
  │     result:'count: 42') ────────│
```

**Error case:**

```
Client                              Server
  │── method(id:'m2',               │
  │    name:'doesNotExist',         │
  │    params:[]) ─────────────────►│
  │                                  │── Methods.call → not found
  │◄── error(id:'m2',               │
  │     error:{code:404,            │
  │       message:'Method not       │
  │       found: doesNotExist'}) ───│
```

---

## 6. What Does the Current App Do

A summary of the application's actual workflow, for context.

### 6.1 The User Flow

1. User opens the app → sees Home page with sidebar (file uploaders, color controls, submit button) and main area (chromosome selector, Hilbert curve view, linear signal view)
2. User selects a `.bam` genomic file via one of the BamUploader components
3. File uploads with progress bar → stored on server disk → metadata in MongoDB
4. File appears in the file list (real-time via pub/sub)
5. User clicks "Submit Job GO!" → calls `runCountC` method → Python script analyzes the BAM file → result returned
6. Results displayed in HilbertCurveViewArea and LinearSignalArea charts

### 6.2 The Current Component Tree

```
App (Router)
├── Navbar
├── Home
│   ├── BamUploader (×3)     ← file upload with progress
│   ├── GoSubmitButton       ← triggers Meteor.callAsync('runCountC')
│   ├── HilbertCurveViewArea ← Highcharts visualization
│   └── LinearSignalArea     ← Highcharts visualization
├── About
└── Usage
```

### 6.3 What Stays the Same

- React + Chakra UI components
- React Router navigation
- Highcharts visualizations
- Python analysis script (`countC.py`)
- The user experience

### 6.4 What Changes (Under the Hood)

- `Meteor.startup()` → Vite entry point
- `Meteor.subscribe()` / `useTracker()` → `MeteorLight.subscribe()` + `store.on('change')`
- `Meteor.callAsync()` → `MeteorLight.call()`
- `BamCollection.insert()` → `MeteorLight.upload()`
- `.meteor/` build system → Vite + tsx
