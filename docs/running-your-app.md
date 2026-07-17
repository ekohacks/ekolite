# Running your app

There are two ways to stand up an EkoLite server. You can assemble one by hand with `App.create` and `createServer`, which is what the [quick start](/quick-start) shows and what you want when you are embedding EkoLite in something else. Or you can let EkoLite run your app for you, the way `meteor run` boots your project rather than one of Meteor's:

```bash
npx ekolite run
```

`ekolite run` reads a config file, assembles the framework against your definitions, serves your client, and arms graceful shutdown. There is no boot file for you to copy and keep in step.

## The shape of a project

```
my-app/
  package.json          # "type": "module"
  ekolite.config.ts     # where the runner finds your app
  app.ts                # your (eko) => void entry: publications and methods
  scripts/              # assets, e.g. a Python script, resolved by eko.asset()
  public/               # your built client, served at /
```

## The config

`ekolite.config.ts` at the project root is how the runner finds everything:

```ts
import { defineConfig } from 'ekolite/config';

export default defineConfig({
  app: './app.ts', // your app entry (a path, or the function inline)
  clientDir: './public', // your built client, served at /
  assetsDir: './scripts', // scripts and fixtures, resolved by eko.asset()
  fileDir: './uploads', // where uploaded files land
});
```

Only `app` is required. The runtime knobs stay in the environment so a deployment overrides them without editing the file: `MONGO_URI` (a replica set, since change streams need one) and `EKOLITE_PORT` (or `PORT`, default `3001`).

## The app entry

Your app entry default-exports a function the runner calls with a narrow context, `eko`. This is where you define your publications and methods:

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

`eko` exposes only what you define against:

| `eko.`         | what it is                                                               |
| -------------- | ------------------------------------------------------------------------ |
| `publications` | define named publications: `define(name, () => ({ collection, query }))` |
| `methods`      | define server methods: `define(name, async (...args) => result)`         |
| `files`        | the file store: `locate(id)`, `read(id)`, `recordCountC(id, n)`          |
| `scriptRunner` | run a child process: `exec(command, args)`                               |
| `asset(name)`  | resolve a bundled asset to an absolute path, against `assetsDir`         |

It deliberately does **not** expose the lifecycle, `armShutdown`, `close`, the Mongo client. Those stay the runner's, so your entry only ever defines.

## Run it

```bash
npx ekolite run
# ekolite: ready on http://localhost:3001
```

The runner reads the config, builds `App.create` from the environment, applies your entry's definitions, serves `clientDir` at `/`, arms graceful shutdown, and prints the ready line. Uploads work at `POST /api/files` and `GET /api/files/:id` with no code of yours, and your publications stream live over the socket.

## Requirements

- **Node 24 or newer.** The runner imports your TypeScript config and entry through Node's native type stripping, so there is no build step between you and `ekolite run` and no extra dependency.
- **`"type": "module"` in `package.json`.** EkoLite is ESM, and the runner loads your `ekolite.config.ts` as an ES module.
- **`moduleResolution` set to `nodenext` (or `bundler`) in `tsconfig.json`.** `ekolite/config` is a subpath export, and TypeScript only reads a package's `exports` map under modern resolution. Without it your editor reports `TS2307: Cannot find module 'ekolite/config'` even though the types ship:

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

`eko.asset('countC.py')` resolves a name against `assetsDir` and hands back an absolute path, the equivalent of Meteor's `Assets.absoluteFilePath`. Ship your scripts and fixtures in `assetsDir` and reference them by name rather than hardcoding a path that breaks once the app is packaged.

## Not yet built

The first cut of `ekolite run` runs your app, and stops there. Scaffolding (`ekolite create`), dev-mode reload, and build orchestration are later work. Build your client with Vite yourself and point `clientDir` at the output.
