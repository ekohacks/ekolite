# Quick start

By the end of this page you will have EkoLite running in your own project: a server on
`localhost:3001`, a publication streaming live documents out of MongoDB, a method your client can
call, the upload routes answering, and a browser client rendering all of it and staying in sync.

Everything below is the real thing. There is no toy mode to graduate out of later.

## Before you start

Four things need to be true, and three of them bite quietly if they are not.

**Node 24 or newer.** The runner loads your TypeScript config and app entry through Node's own
type stripping, so there is no build step between you and `ekolite run`, and nothing extra to
install. The package declares `engines.node >= 24`, and that is the version the runner is tested
against.

**`"type": "module"` in your `package.json`.** EkoLite is ESM throughout and the runner loads
your `ekolite.config.ts` as an ES module.

**`moduleResolution` set to `nodenext` in your `tsconfig.json`.** `ekolite/config`, `ekolite/client`
and the rest are subpath exports, and TypeScript only reads a package's `exports` map under modern
resolution. Miss this and your editor swears it cannot find `ekolite/config` (`TS2307`) even though
the types are sitting right there in the package:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true
  }
}
```

You do not need to install `@types/node`. EkoLite's public types mention `Buffer` and `node:http`,
so it depends on them for you.

One wrinkle that is not ours: on `@types/node` 26, `tsc` reports a single error inside
`node_modules/thread-stream`, which reaches you through Fastify's logger. It is a type-only
disagreement in a package neither you nor EkoLite calls directly, there is no fixed release yet, and
`"skipLibCheck": true` silences it until there is.

**MongoDB as a replica set.** Publications are built on change streams, and change streams only
exist on a replica set. A standalone `mongod` will connect fine and then never send you an update.
The next section gets you one.

## Install

```bash
npm install ekolite
```

## Get MongoDB running

A single node replica set is enough for development. Drop this in `docker-compose.yml`:

```yaml
services:
  mongo:
    image: mongo:7
    ports:
      - '27017:27017'
    command: ['--replSet', 'rs0']
    volumes:
      - mongo-data:/data/db
    healthcheck:
      test: ['CMD', 'mongosh', '--eval', "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5

  mongo-init:
    image: mongo:7
    depends_on:
      mongo:
        condition: service_healthy
    restart: 'no'
    entrypoint:
      [
        'mongosh',
        '--host',
        'mongo',
        '--eval',
        "try { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] }) } catch(e) { if (e.codeName !== 'AlreadyInitialized') throw e }",
      ]

volumes:
  mongo-data:
```

```bash
docker compose up -d
```

The `mongo-init` container runs once, initiates the replica set, and exits. Running it again against
an already initiated node is a no op, so `docker compose up` stays safe to repeat.

## What a project looks like

Nothing exotic. A config file, an app entry, and wherever your client and assets happen to live:

```
my-app/
  package.json          # "type": "module"
  ekolite.config.ts     # where the runner finds your app
  app.ts                # your app entry: publications and methods
  scripts/              # assets, a Python script say, reached through eko.asset()
  public/               # your built client, served at /
```

## Your app entry

The entry exports one function as its default. The runner calls it with a narrow context, `eko`,
and that is where your publications and methods go:

```ts
import type { AppEntry } from 'ekolite/config';
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URI ?? 'mongodb://localhost:27017/ekolite');
const tasks = client.db().collection('tasks');

const app: AppEntry = (eko) => {
  eko.publications.define('tasks.all', () => ({ collection: 'tasks', query: {} }));

  eko.publications.define('tasks.mine', (params) => ({
    collection: 'tasks',
    query: { owner: params?.owner },
  }));

  eko.methods.define('addTask', async (title) => {
    const result = await tasks.insertOne({ title: String(title), owner: 'ada' });
    return result.insertedId.toString();
  });
};

export default app;
```

A publication is a function from the subscriber's params to a collection and a query. EkoLite runs
the query, streams the matching documents to the client, then watches the collection and forwards
every later change on the same socket. A method is a plain function: whatever it returns goes back
to the caller, whatever it throws comes back as an error.

Note the `MongoClient` of your own at the top, and note what it means. `eko` deliberately hands you
no database handle: reading is EkoLite's job through publications, but writing is yours, so you
bring your own driver and talk to Mongo directly. `npm install mongodb` if it is not already there.
Point it at the same `MONGO_URI` the runner uses, or your writes will land somewhere your
publications are not watching.

Note too that arguments arrive as `unknown`. They came off a socket from a browser, so EkoLite hands
them to you untrusted rather than pretending to know their shape.

## Point the runner at your app

`ekolite.config.ts` at the project root is how the runner finds everything:

```ts
import { defineConfig } from 'ekolite/config';

export default defineConfig({
  app: './app.ts', // your app entry, a path or the function inline
  clientDir: './public', // your built client, served at /
  assetsDir: './scripts', // scripts and fixtures, reached through eko.asset()
  fileDir: './uploads', // where uploaded files land
  allowedExtensions: ['bam', 'csv'], // what uploads may be, lowercase and without the dot
});
```

Only `app` is required. The runtime knobs stay in the environment so a deployment can change them
without anyone touching this file:

| variable       | what it sets                                           | default                             |
| -------------- | ------------------------------------------------------ | ----------------------------------- |
| `MONGO_URI`    | the replica set to connect to                          | `mongodb://localhost:27017/ekolite` |
| `EKOLITE_PORT` | the port to listen on, or `PORT`                       | `3001`                              |
| `FILE_DIR`     | where uploads land, if the config leaves `fileDir` out | `./uploads`                         |

## Run it

```bash
npx ekolite run
# ekolite: ready on http://localhost:3001
```

Underneath, the runner reads your config, builds the app against real Mongo and a real socket,
applies your entry's definitions, serves `clientDir` at `/`, arms graceful shutdown, and prints that
ready line once it is genuinely listening. There is no boot file for you to copy and keep in step
with the framework as it moves.

## Talk to it from the browser

The server is up. Now connect to it. The socket lives at `/ws`:

```ts
import { ClientSocketWrapper, ConnectionManager } from 'ekolite/client';

const socket = ClientSocketWrapper.create('ws://localhost:3001/ws');
await socket.connect();
const connection = new ConnectionManager(socket);

const handle = connection.subscribe('tasks.all');
await handle.ready;

const tasks = connection.store('tasks');
render(tasks.getAll());
tasks.onChange(() => render(tasks.getAll()));
```

Two things there are worth slowing down for.

`connection.store('tasks')` takes the **collection** name, not the subscription name. The server
decides which collection a publication reads from, and the client learns it from the `ready` message.
Subscribing to `tasks.mine` still gives you the `tasks` store.

The explicit `render(tasks.getAll())` before `onChange` is not redundant. The initial batch of
documents lands in the store during `ready`, which has already resolved by the time you register the
listener. Without that first render the page sits empty until something changes.

Calling a method is a one liner on the same connection:

```ts
await connection.call('addTask', 'write the docs');
```

Call `handle.stop()` when you no longer want the data, and the server stops sending it.

### React

`ekolite/react` ships `useSubscription`, which does the whole dance above for you. It subscribes on
mount, streams the collection through `useSyncExternalStore`, reports loading, and unsubscribes on
unmount:

```tsx
import { useSubscription } from 'ekolite/react';

function TaskList({ connection }) {
  const { data, isLoading } = useSubscription(connection, 'tasks.all', 'tasks');
  if (isLoading) return <p>Loading</p>;
  return (
    <ul>
      {data.map((task) => (
        <li key={task._id}>{task.title}</li>
      ))}
    </ul>
  );
}
```

`connection` is the `ConnectionManager` you built above: make it once, connect it, and pass it down
or put it on a context. React 18 or newer is an optional peer dependency, so every other entry point
stays framework agnostic.

EkoLite does not build your client. Build it with Vite or whatever you already use, and point
`clientDir` at whatever that produces.

## File uploads

You get these two routes without writing any code, as soon as the server is running:

```bash
curl -F file=@sample.bam http://localhost:3001/api/files  # 201 { "id": "...", "name": "sample.bam" }
curl http://localhost:3001/api/files/<id> -O              # the bytes back
```

Uploaded files land in `fileDir`, which is created for you, and are recorded in Mongo, so a
publication over the `files` collection streams them to the client like anything else.

The route only accepts what you have allowed. Say nothing and that is `.bam` alone, left over from
the genomics work EkoLite grew out of, so anything else comes back refused:

```bash
curl -F file=@notes.txt http://localhost:3001/api/files
# 400 {"code":400,"message":"Unsupported file type: .txt"}
```

`allowedExtensions` in `ekolite.config.ts` is how you say otherwise. Give it the list your app
actually moves, lowercase and without the dot, and that list replaces the default rather than adding
to it: `['csv', 'json']` means `.bam` is refused too. The check is on the extension of the filename
and nothing more, so treat it as a way to keep the obvious wrong file out, not as proof of what the
bytes are.

Leaving the key out keeps the `.bam` default, which is deliberate. Upgrading EkoLite should never
quietly start accepting file types your deployment was refusing yesterday, and that matters more than
usual while the file routes still have no auth on them.

## Assets

`eko.asset('countC.py')` takes a name, resolves it against `assetsDir`, and hands back an absolute
path. It is EkoLite's answer to Meteor's `Assets.absoluteFilePath`: ship your scripts and fixtures in
`assetsDir` and reach for them by name, rather than hardcoding a path that falls apart the moment the
app is packaged. Pair it with `eko.scriptRunner` to shell out:

```ts
eko.methods.define('countC', async (fileId) => {
  const file = await eko.files.locate(String(fileId));
  if (file === undefined) throw new Error('file not found');
  const result = await eko.scriptRunner.exec('python3', [eko.asset('countC.py'), file.path]);
  return Number(result.stdout.trim());
});
```

## What `eko` gives you

| `eko.`         | what it gives you                                                 |
| -------------- | ----------------------------------------------------------------- |
| `publications` | name a publication: `define(name, () => ({ collection, query }))` |
| `methods`      | name a server method: `define(name, async (...args) => result)`   |
| `files`        | the file store: `locate(id)`, `read(id)`, `recordCountC(id, n)`   |
| `scriptRunner` | run a child process: `exec(command, args)`                        |
| `asset(name)`  | resolve a bundled asset to an absolute path, against `assetsDir`  |

What it holds back is the lifecycle: `armShutdown`, `close`, the Mongo client. Those stay the
runner's business, so your entry only ever defines, and never has to think about booting or stopping.

## Testing without MongoDB

`App.createNull()` assembles the entire graph in memory. No Mongo, no socket, no ports, and it
returns instantly, so your tests can exercise methods, publications and files at full speed:

```ts
import { App } from 'ekolite';

const app = App.createNull();
app.methods.define('greet', (name) => `hello ${String(name)}`);
await app.methods.call('greet', ['world']); // 'hello world'
```

Note that `app.methods.call` takes its arguments as an array on the server, while the client's
`connection.call` is variadic.

What comes back is empty. EkoLite wires the infrastructure and stops, so `app.publications` and
`app.methods` hold exactly what you put on them and nothing of the framework's own.

## Wiring it yourself

`ekolite run` is the short road, and most projects should stay on it. If you are dropping EkoLite
inside something bigger and want to hold the reins, `App.create` and `createServer` are both exported
from the main entry. `App.create` assembles the graph but does not listen, so you serve it yourself:

```ts
import { App, createServer } from 'ekolite';

const app = App.create({ mongoUri, fileDir, port });
app.publications.define('tasks.all', () => ({ collection: 'tasks', query: {} }));

const server = await createServer({
  ws: app.ws,
  publications: app.publications,
  rpcHandler: app.rpcHandler,
  files: app.files,
  staticRoot: './public', // leave it out and nothing is served at /
});
await server.listen({ port, host: '0.0.0.0' });
app.armShutdown();
```

That is exactly what the runner does on your behalf, which is the point: there is nothing in
`ekolite run` you cannot reach for directly.

## The five entry points

Everything else stays internal for now:

<!-- ekohacks:entry-points -->

```ts
import { App } from 'ekolite'; // the server framework
import { ConnectionManager } from 'ekolite/client'; // the browser client stack
import { useSubscription } from 'ekolite/react'; // the React binding (React 18+, optional peer)
import { defineConfig } from 'ekolite/config'; // the runner's config schema (ekolite.config.ts)
import type { ReadyMsg } from 'ekolite/shared'; // the wire protocol types
```

<!-- /ekohacks:entry-points -->

## What is not here yet

This first cut of `ekolite run` runs your app, and that is where it stops. Scaffolding
(`ekolite create`), dev mode reload, and build orchestration are still ahead of us.

One more gap you will meet on this page rather than read about elsewhere: the file routes have no
auth on them at all. Anyone who can reach the server can upload, and `allowedExtensions` narrows what
they may send rather than who may send it.

## Where next

- [Overview](/ekolite-overview/ekolite-overview). What EkoLite is and how the pieces fit together.
- [System design](/ekolite-overview/ekolite-system-design). How the framework is put together, and the wire protocol.
- [API reference](/api/connection-manager). The client `ConnectionManager` and `SubscriptionHandle`.
