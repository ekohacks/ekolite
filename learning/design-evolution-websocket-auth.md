# Design Evolution: WebSocket Auth and the Options Problem

> "Knowledge emerges only through invention and reinvention, through the restless, impatient, continuing, hopeful inquiry human beings pursue in the world." Paulo Freire

This one is about how a design changes when it hits a real constraint. We had working code. We had passing tests. Then the code ran in the browser and broke. The fix solved the browser problem but created a gap in our test coverage. We spotted the gap, reasoned about it, and closed it. This session walks through that whole journey so you can see how design evolves when you pay attention.

## Where we started

`ClientSocket.create()` used to look like this:

```ts
static create(url: string, options: ClientOptions = {}): ClientSocket {
  const parsed = new URL(url);
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error(`Invalid WebSocket URL: expected ws:// or wss://, got ${parsed.protocol}`);
  }
  return new ClientSocket(new RealClientSocket(url, options));
}
```

And `RealClientSocket` passed those options straight through to the `ws` library:

```ts
this.socket = new WebSocket(this.url, this.options);
```

`ClientOptions` came from the `ws` package. It let you pass headers, custom agents, TLS options, anything Node's HTTP stack supports during the WebSocket upgrade handshake.

The auth integration tests used this to pass an `Authorization` header:

```ts
const client = ClientSocket.create(`ws://localhost:${String(PORT)}`, {
  headers: { Authorization: 'Bearer test-token' },
});
await client.connect();
expect(client.isConnected).toBe(true);
```

That tested our code. `ClientSocket` received options, forwarded them to the real WebSocket, and the server's `verifyClient` callback accepted or rejected the connection based on the header.

## What broke

The browser's WebSocket constructor is not the same as the `ws` library's constructor.

```
ws library (Node):     new WebSocket(url, protocols, options)
Browser (native):      new WebSocket(url, protocols)
```

No options. No headers. The browser doesn't let JavaScript set custom headers on a WebSocket upgrade request. That's by design. The browser controls the upgrade handshake, not your code.

So when we removed the `ws` import to fix the browser error, the options parameter became meaningless. There was nothing to pass it to.

**Question for the pair:** Why would the browser prevent you from setting custom headers on a WebSocket upgrade? Think about what a malicious script could do if it could set arbitrary headers on cross origin requests.

## The gap

With the `ws` import gone and the options removed, the auth tests had nothing to go through. They couldn't call `ClientSocket.create(url, { headers: ... })` anymore because that API didn't exist.

That left us with a choice: drop the auth tests entirely, or find a way to do auth that works in the browser and goes through our code.

**Question for the pair:** Why is it a problem if our tests only exercise someone else's library? Think about what happens when you upgrade the library. Think about what the test is supposed to catch and whether it can still catch it.

## The real question

The question isn't "how do we put the options back." The question is: **does our WebSocket connection need authentication, and if so, whose job is it?**

### What does our app actually do?

Right now, EkoLite is a single page app. One page, one server, no users, no login. Anyone who can reach the server can connect. That's fine for a demo.

**Question for the pair:** At what point would we actually need auth on the WebSocket? What would have to change in the app for unauthenticated connections to be a problem?

### If we do need auth, where does the check happen?

There are two sides to every connection. The client sends something. The server checks it. Both sides need to agree on what "something" is.

**Server side (Fastify):**

The server already has access to everything it needs during the upgrade handshake. Look at `server/plugins/websocketRoutes.ts`:

```ts
app.get('/ws', { websocket: true }, (socket) => {
  // ...
});
```

That handler receives the socket, but the route also has access to the HTTP request via Fastify's hook system. You could add a `preValidation` hook, check a cookie, check a query param, check whatever you like. If validation fails, Fastify returns a 401 before the WebSocket connection is ever established.

**Question for the pair:** What is the difference between checking auth during the upgrade handshake vs checking auth after the connection is open? Think about timing. Think about what happens if an unauthenticated client connects and the server has to kick them off.

### What can the browser actually send?

The browser's WebSocket constructor gives you two things to work with:

1. **The URL** including query parameters
2. **Protocols** (a string or array of strings)

That's it. No headers. No body. But the browser also sends cookies automatically on the upgrade request if the domain matches.

So the browser compatible auth options are:

| Approach          | How it works                                                                                | Tradeoff                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Cookies**       | Server sets an HTTP-only cookie on login. Browser sends it automatically on the WS upgrade. | Requires a login flow first. Cookie handling adds complexity. But it's the most secure and the client code doesn't need to know about auth at all.           |
| **Query params**  | `ws://localhost/ws?token=xxx`                                                               | Simple. But the token is in the URL. URLs end up in server logs, browser history, proxy logs. Not great for secrets.                                         |
| **First message** | Connect first, then send `{ type: 'auth', token: 'xxx' }` as the first message.             | Works with any transport. But there's a window between connect and auth where the client is connected but unverified. The server needs to handle that state. |
| **Subprotocol**   | `new WebSocket(url, 'token.xxx')`                                                           | Hacky. The protocol field isn't meant for auth. Some libraries don't handle it well.                                                                         |

**Question for the pair:** Look at the tradeoffs. Which approach fits EkoLite best right now? Think about what we're building, who the users are, and what's simplest. Think about which approach our Fastify server could check with the least new code.

## What we chose

Query params. Simplest thing that works in the browser and lets us test our own code.

`ClientSocket.create()` now takes an optional `{ token }`:

```ts
static create(url: string, options?: { token?: string }): ClientSocket {
  const parsed = new URL(url);
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error(`Invalid WebSocket URL: expected ws:// or wss://, got ${parsed.protocol}`);
  }
  if (options?.token) {
    parsed.searchParams.set('token', options.token);
  }

  return new ClientSocket(new RealClientSocket(parsed.toString()));
}
```

If you pass a token, it gets appended to the URL as a query parameter. `ClientSocket` builds the URL. The server checks the URL. Both sides are our code.

**Stop and read.** Open `client/clientSocket.ts` and find `create()`. Then open `tests/client/clientSocket.integration.test.ts` and find the auth describe block. Read the `createAuthServer()` function. Trace how the token flows from the test, through `create()`, into the URL, and into the server's `verifyClient` callback.

The integration tests now look like this:

```ts
it('rejects connections without a token', async () => {
  rawServer = createAuthServer();
  const client = ClientSocket.create(`ws://localhost:${String(PORT)}`);
  await expect(client.connect()).rejects.toThrow();
});

it('connects when a valid token is provided', async () => {
  rawServer = createAuthServer();
  const client = ClientSocket.create(`ws://localhost:${String(PORT)}`, {
    token: 'test-token',
  });
  await client.connect();
  expect(client.isConnected).toBe(true);
  await client.close();
});
```

Both tests go through `ClientSocket.create()`. Both tests exercise our code. The `ws` library and `WebSocketServer` are just the transport underneath. They should have tested their own code. We test ours.

**Question for the pair:** The server in the test uses `verifyClient` from the `ws` library's `WebSocketServer`. In production we'd use Fastify with a `preValidation` hook instead. Does that matter for what we're testing here? What are we actually proving with these tests?

## The tradeoff we accepted

The token is in the URL. That means it's visible in server logs, browser history, and any proxy between client and server. For a demo app with no real users, that's fine. For production with real credentials, we'd probably move to cookies or short lived tokens.

**Question for the pair:** Is there a risk in building on top of query param auth and then needing to change later? What would have to change in `ClientSocket` if we switched to cookies? What about the tests?

## The design evolution lesson

Here's what happened, step by step:

1. We built `ClientSocket` with the `ws` library. It worked. Tests passed.
2. We ran it in the browser. It broke because `ws` is Node only.
3. We removed the `ws` dependency. That fixed the browser but removed the options parameter.
4. The auth tests lost their connection to our code. We spotted the gap.
5. We looked at the browser compatible options, picked query params, and rebuilt auth through our own API.
6. The tests go through our code again. The gap is closed.

That's how design evolves. You make a choice, you learn something, the choice no longer fits, you adapt. Each step made sense at the time. The important thing is that we noticed the gap at step 4 instead of shipping it and moving on.

**The rule:** When a constraint forces you to change your approach, don't just fix the immediate problem. Trace the impact. Check what else broke. A fix that creates a gap you don't know about is worse than the original bug.

> At EkoHacks we don't just ship code. We understand why the design is the way it is, and we can trace every decision back to a real constraint.
