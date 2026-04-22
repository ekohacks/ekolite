# Two Fastify Instances, and the Test That Caught Them

> "The teacher is of course an artist, but being an artist does not mean that he or she can make the profile, can shape the students. What the educator does in teaching is to make it possible for the students to become themselves." Paulo Freire

At EkoHacks we do not hand you the fix and move on. We show you the broken thing, pose the question, and let you see the shape of it yourself. When you recognise it next time, and you will, you will not need anyone to tell you.

## The broken thing

Check out the EkoLite branch before EKO-260 lands. Boot the server with `npm run dev:server`. Open a browser. Open devtools. Type:

```js
new WebSocket('ws://localhost:3001/ws');
```

Hit enter. Watch the close code. 1006. The connection never opened. No error on the server terminal. The logs look fine. Everything else works.

**Question for the pair:** the HTTP side serves the page, the server is clearly listening, the route was coded and tested. Why is the socket not opening?

## Where the route actually went

Open `server/start.ts` on that branch:

```ts
const fastify = Fastify();
const ws = WebSocketWrapper.create(fastify);
const server = await createServer({ ws });
await server.listen({ port: 3001 });
```

Now open `server/index.ts`:

```ts
export async function createServer(options: ServerOptions) {
  const server = Fastify();
  await server.register(fastifyStatic, {
    /* ... */
  });
  await options.ws.start();
  return server;
}
```

Read those two blocks side by side. `start.ts` calls `Fastify()` once. `createServer` calls `Fastify()` again. Two different objects.

The wrapper was handed the `start.ts` Fastify. It registered `/ws` on that one. `server.listen(3001)` was called on the _other_ Fastify, the one `createServer` made and returned. The route and the listener are on different objects. The listener has no `/ws`. Hence 1006.

**Question for the pair:** how did this get past review? The test suite was green. Look at `tests/infrastructure/websocket-fastify.integration.test.ts` and ask yourself what it actually tested.

The answer is that the wrapper integration test wires its own Fastify end to end, never going through `createServer`. It proves the wrapper works when given a Fastify. It does not prove the wrapper works when used as `createServer` was meant to use it. The test passed because it asked a question that did not match the production path.

## The signature that lied

Look at what the API demanded. `WebSocketWrapper.create(fastify: FastifyInstance)`. It wanted a Fastify at construction time.

**Question for the pair:** at what point in `start.ts` does a Fastify exist that gets listened on?

Only after `createServer` returns. The `createServer` function builds its own Fastify, registers static, registers the wrapper, and hands the Fastify back to the caller. That is the Fastify that then listens on 3001.

So when `start.ts` needs to build a wrapper before calling `createServer`, it has no Fastify to give. It invented a throwaway one to satisfy the signature. The signature pretended that was fine. The throwaway Fastify was never listened on, which made the whole feature dead on arrival.

The old signature was demanding a value nobody had. That is the bug.

## The failing test

The integration test at `tests/server/server.integration.test.ts` expressed the right contract:

```ts
const ws = WebSocketWrapper.create();
server = await createServer({ ws });
await server.listen({ port: 0 });
const port = String(server.addresses()[0].port);
client = new WebSocket(`ws://localhost:${port}/ws`);
```

Notice what it does not do. It does not hand Fastify to `create`. It is saying: the wrapper should be buildable without a Fastify, because I do not have one yet.

The test was telling the truth. The code was lying. We changed the code.

## The shape we landed on

Two verbs on the wrapper, each tied to a moment in the lifecycle:

```ts
static create(): WebSocketWrapper
async attach(fastify: FastifyInstance): Promise<void>   // Fastify mode
async start(): Promise<void>                             // raw standalone mode
```

`create()` makes a wrapper that does not know about Fastify yet. `createServer` builds its Fastify, then calls `options.ws.attach(server)` as the last step. The Fastify that listens is the same object the route is registered on. Single instance, single lifecycle.

`start()` stays on the wrapper for the raw mode, where `createRawWs({port})` boots its own standalone WebSocket server on its own port. No Fastify involved, so nothing to attach to. Two modes, two verbs, two different jobs.

## The pattern to carry forward

**When you inject a dependency, check the timing.** Ask whether the dependency exists at the moment you would construct the thing that needs it. If the answer is no, the constructor is the wrong door. Split construction from binding.

The old signature `create(x)` fused the two. You had to have `x` at the moment you built the thing. If `x` was not yet available, callers had to invent one, and the invention almost always ended up useless, like the throwaway Fastify in `start.ts`.

The new shape `create()` plus `attach(x)` treats them as two moments. Build the thing. Later, when `x` exists, bind them together. The caller does not have to lie about what they have.

This pattern shows up everywhere. Anywhere a wrapper, a service, a helper needs a resource that a later step produces. Database connections, loggers, feature flags, session contexts. If your constructor is asking for something that only exists after the caller has done more setup, you have the same bug waiting to happen.

## The wider lesson

The code and the test disagreed. One of them was wrong.

When a test compiles against an API that does not exist yet, ask whose version of reality is truer. In this case the test was expressing how a caller genuinely needs to use the wrapper. The code was expressing a fantasy about dependencies being ready on demand.

Change the code, not the test. The compiler will walk you through every place the old shape was hiding.
