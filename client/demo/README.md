# EkoLite client demo

A runnable demo of the client stack with no backend. It drives the real
`ConnectionManager`, `SubscriptionHandle` and `ReactiveStore` through a stubbed
server, so you can watch subscriptions and the reactive store update live without
Mongo or a running server.

## Run it

```bash
npm run dev:client
```

Vite prints a local URL such as `http://localhost:5173/`. Open the demo at the
`/demo/` path (the trailing slash matters):

```
http://localhost:5173/demo/
```

If port 5173 is busy Vite picks the next one (5174 and so on), so use whatever it
prints. The root URL `/` is the placeholder page and has no buttons; the demo is
under `/demo/`.

## What you see

- A status line: connecting, then connected and subscription ready.
- A files list, seeded with two documents once the subscription is ready.
- Four buttons that play the part of server messages:
  - **Add file** sends an `added` message, a new row appears.
  - **Rename first** sends a `changed` message, the first row updates in place.
  - **Remove first** sends a `removed` message, the first row disappears.
  - **Disconnect** closes the socket, which disposes the `ConnectionManager` and
    disables the buttons.
- A log of the messages the stubbed server sent.

## The point

The demo wires a null socket:

```ts
const socket = ClientSocketWrapper.createNull();
```

Swap that one line for a real connection and the same `ConnectionManager` and
`ReactiveStore` code talks to a live server:

```ts
const socket = ClientSocketWrapper.create('wss://your-host/ws');
```

That is the Nullables payoff: the code in the demo and the code in production are
the same; only the socket changes.

## Run it live (against a real server)

`live.ts` is the same client code with that one line swapped for a real socket,
pointed at a running server. You need MongoDB on `localhost:27017` and a server.

```bash
# 1. start the server (Mongo + websocket + publications)
npm run dev:server

# 2. in another terminal, start vite and open the live page
npm run dev:client
#    http://localhost:5173/demo/live.html
```

The server seeds two files on first boot, so a fresh Mongo is not a blank page.
The list then streams straight from Mongo. To watch it update live, change the
collection in another window and the page reacts:

```js
// mongosh
use ekolite
db.files.insertOne({ name: 'hello.txt' })
db.files.updateOne({ name: 'hello.txt' }, { $set: { name: 'renamed.txt' } })
db.files.deleteOne({ name: 'renamed.txt' })
```

Live streaming uses Mongo change streams, which need a replica set. A standalone
Mongo still serves the initial documents (so the page is not empty); it just will
not push later changes. For live updates run Mongo as a single-node replica set.

There are no buttons on the live page: writing from the browser needs the
methods/RPC path, which is the next epic. For now the browser reads, and writes
happen in Mongo.

## Note

The full browser to Mongo round trip is wired now (see `server/start.ts` and the
end-to-end test at `tests/server/livePubsub.integration.test.ts`). See the client
API reference in [`docs/api/`](../../docs/api/connection-manager.md).
