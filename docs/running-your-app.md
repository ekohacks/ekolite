# Running your app

You have written your publications and methods. Now you want a server running them, and EkoLite gives you two ways to get there.

You can wire one up by hand with `App.create` and `createServer`, which is what the [quick start](/quick-start) shows. That is the right call when you are dropping EkoLite inside something bigger and want to hold the reins yourself.

Or you can let EkoLite run the app for you, the way `meteor run` boots your project rather than one of Meteor's:

```bash
npx ekolite run
```

`ekolite run` reads a small config file, assembles the framework around your definitions, serves your client, and arms graceful shutdown. There is no boot file for you to copy and keep in step with the framework as it moves.

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

## Pointing the runner at your app

`ekolite.config.ts` at the root is how the runner finds everything:

```ts
import { defineConfig } from 'ekolite/config';

export default defineConfig({
  app: './app.ts', // your app entry, a path or the function inline
  clientDir: './public', // your built client, served at /
  assetsDir: './scripts', // scripts and fixtures, reached through eko.asset()
  fileDir: './uploads', // where uploaded files land
});
```

Only `app` is required. The runtime knobs stay in the environment, so a deployment can change them without anyone touching this file: `MONGO_URI` (a replica set, since change streams need one) and `EKOLITE_PORT` (or `PORT`, defaulting to `3001`).

## Your app entry

The entry exports one function as its default. The runner calls it with a narrow context, `eko`, and that is where your publications and methods go:

```ts
import type { AppEntry } from 'ekolite/config';

const app: AppEntry = (eko) => {
  eko.publications.define('files.all', () => ({ collection: 'files', query: {} }));

  eko.methods.define('countC', async (fileId) => {
    const file = await eko.files.locate(String(fileId));
    if (file === undefined) throw new Error('file not found');
    const result = await eko.scriptRunner.exec('python3', [eko.asset('countC.py'), file.path]);
    return Number(result.stdout.trim());
  });
};

export default app;
```

`eko` hands you only the things you define against:

| `eko.`         | what it gives you                                                 |
| -------------- | ----------------------------------------------------------------- |
| `publications` | name a publication: `define(name, () => ({ collection, query }))` |
| `methods`      | name a server method: `define(name, async (...args) => result)`   |
| `files`        | the file store: `locate(id)`, `read(id)`, `recordCountC(id, n)`   |
| `scriptRunner` | run a child process: `exec(command, args)`                        |
| `asset(name)`  | resolve a bundled asset to an absolute path, against `assetsDir`  |

What it holds back is the lifecycle: `armShutdown`, `close`, the Mongo client. Those stay the runner's business, so your entry only ever defines, and never has to think about booting or stopping.

## Running it

```bash
npx ekolite run
# ekolite: ready on http://localhost:3001
```

Underneath, the runner reads your config, builds `App.create` from the environment, applies your entry's definitions, serves `clientDir` at `/`, arms graceful shutdown, and prints that ready line once it is genuinely listening. Uploads work at `POST /api/files` and `GET /api/files/:id` with no code of yours, and your publications stream live over the socket.

## A few things to have in place

- **Node 24 or newer.** The runner loads your TypeScript config and entry through Node's own type stripping, so there is no build step between you and `ekolite run`, and nothing extra to install.
- **`"type": "module"` in your `package.json`.** EkoLite is ESM through and through, and the runner loads your `ekolite.config.ts` as an ES module.
- **`moduleResolution` set to `nodenext` (or `bundler`) in `tsconfig.json`.** `ekolite/config` is a subpath export, and TypeScript only reads a package's `exports` map under modern resolution. Miss this and your editor swears it cannot find `ekolite/config` (`TS2307`), even though the types are sitting right there in the package:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true
  }
}
```

## Assets

`eko.asset('countC.py')` takes a name, resolves it against `assetsDir`, and hands you back an absolute path. It is EkoLite's answer to Meteor's `Assets.absoluteFilePath`: ship your scripts and fixtures in `assetsDir` and reach for them by name, rather than hardcoding a path that falls apart the moment the app is packaged.

## What is not here yet

This first cut of `ekolite run` runs your app, and that is where it stops. Scaffolding (`ekolite create`), dev mode reload, and build orchestration are still ahead of us. For now, build your client with Vite yourself and point `clientDir` at whatever it produces.
