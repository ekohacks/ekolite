# Security First: What PR #20 Taught Us

> "Education must begin with the solution of the student teacher contradiction, by reconciling the poles of the contradiction so that both are simultaneously teachers and students." Paulo Freire

This is not a lecture. This is a conversation. Read the code, answer the questions, and talk to your pair about what you notice. The goal is not to memorise rules. The goal is to train your eye so you see these things before anyone has to point them out.

## 1. The Hanging Promise

Here is the original `connect()` method. Read it carefully.

```ts
connect(): Promise<void> {
  return new Promise((resolve) => {
    this.socket = new WebSocket(this.url);
    this.socket.onopen = () => {
      resolve();
    };
    // this.socket.onerror = (err) => reject(err);
  });
}
```

**Stop and think:**

- What happens if the server is not running?
- What happens if the URL is wrong?
- The promise resolves on `onopen`. What resolves it on failure?
- If nothing resolves or rejects a promise, what happens to the caller that `await`s it?

**Try it yourself.** Paste this into a scratch file and run it:

```ts
const never = new Promise((resolve) => {
  // imagine the callback never fires
});

console.log('before await');
await never;
console.log('after await'); // does this ever print?
```

**The lesson:** Every `new Promise` needs both a resolve path AND a reject path. If you only handle the happy path, the sad path hangs forever. No error, no crash, just silence. That is worse than a crash because nobody knows something went wrong.

**Now look at the fix:**

```ts
connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    this.socket = new WebSocket(this.url, this.options);
    this.socket.onopen = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    this.socket.onerror = (err) => {
      if (!settled) {
        settled = true;
        reject(new Error(err.message satisfies string));
      }
    };
  });
}
```

**Questions for the pair:**

- Why is `reject` wrapped in `new Error()`? What happens if you reject with something that is not an Error?
- What is the `settled` flag doing? Can both `onopen` and `onerror` fire? (Yes, they can. Google "WebSocket onerror onclose order".)
- If we removed the `settled` guard, what would happen when both events fire?

## 2. The URL You Never Checked

Original code:

```ts
static create(url: string): ClientSocket {
  return new ClientSocket(new RealClientSocket(url));
}
```

**Stop and think:**

- What happens if someone passes `http://localhost:8080`?
- What happens if someone passes `ftp://dodgy-server.com/payload`?
- The `ws` library (the Node.js WebSocket client we use) will try to connect to anything. Should your code trust that every string it receives is a valid WebSocket URL?

**The principle:** Validate at the boundary. When data enters your system from outside (user input, config, function parameters), check it before using it. Do not assume the caller got it right.

**The fix:**

```ts
static create(url: string, options: ClientOptions = {}): ClientSocket {
  const parsed = new URL(url);
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error(
      `Invalid WebSocket URL: expected ws:// or wss://, got ${parsed.protocol}`
    );
  }
  return new ClientSocket(new RealClientSocket(url, options));
}
```

**Questions for the pair:**

- What does `new URL(url)` do if the string is not a valid URL at all? (Try it in the console.)
- Why do we check protocol specifically? What attack could a bad protocol enable?
- Should this check live in `create()` or in `RealClientSocket`'s constructor? What is the tradeoff?

## 3. The Open Door

Here is the original integration test server:

```ts
webSocketServer = WebSocketWrapper.createRawWs({ port: PORT });
await webSocketServer.start();
const client = ClientSocket.create('ws://localhost:9877');
await client.connect();
// connected! no questions asked
```

**Stop and think:**

- The server accepted the connection. Did it ask who the client was?
- Could any process on the machine connect to this port?
- In production, could any browser on the internet connect?
- What is the difference between authentication (who are you?) and authorisation (are you allowed to do this?)?

**Now look at the auth test:**

```ts
function createAuthServer(): WebSocketServer {
  return new WebSocketServer({
    port: PORT,
    verifyClient: (info, cb) => {
      const token = info.req.headers['authorization'];
      if (!token) {
        cb(false, 401, 'Unauthorized');
        return;
      }
      cb(true);
    },
  });
}

it('rejects connections without an auth token', async () => {
  rawServer = createAuthServer();
  const client = ClientSocket.create(`ws://localhost:${String(PORT)}`, {});
  await expect(client.connect()).rejects.toThrow();
});

it('connects when a valid auth header is provided', async () => {
  rawServer = createAuthServer();
  const client = ClientSocket.create(`ws://localhost:${String(PORT)}`, {
    headers: { Authorization: 'Bearer test-token' },
  });
  await client.connect();
  expect(client.isConnected).toBe(true);
  await client.close();
});
```

**Questions for the pair:**

- The `verifyClient` callback runs during the HTTP upgrade handshake, before the WebSocket connection is established. Why is that important? What if we checked auth after the connection was open?
- This test accepts any non empty token. What would a real implementation need to check?
- Where should the auth check live: the client, the server, or both? Why?
- What is `Bearer` in `Bearer test-token`? Look up "RFC 6750".

## 4. The Tests That Lied

The original integration test had this:

```ts
webSocketServer
  .close()
  .then(() => {
    expect(client.isConnected).toBe(false);
  })
  .catch(() => {
    expect(client.isConnected).toBe(true);
  });
```

This test passed. But the assertions inside `.then()` and `.catch()` never actually ran.

**Stop and think:**

- The test function is `async`. The `.then()` chain is not `await`ed. What happens?
- The test runner sees no errors thrown synchronously, so it reports green. But did it actually test anything?
- How would you prove that a test assertion is actually running? Try it.

**The lesson:** A green test is not the same as a good test. A test that never runs its assertions is worse than no test at all because it gives you false confidence. Always `await` your promises in async tests.

## 5. The Cleanup That Wasn't

Original `afterEach`:

```ts
afterEach(async () => {
  await server.close(); // closes the Fastify server
});
```

But the test created a `webSocketServer` on port 9877 that was never cleaned up in `afterEach`.

**Stop and think:**

- What happens to a port when a server is not properly closed?
- If this test file had two tests, what would happen when the second test tries to start a server on the same port?
- What is a resource leak? Can you name three types? (File handles, database connections, network ports...)

**The principle:** If you open it, close it. If you start it, stop it. Always in `afterEach`, never inside the test body, because `afterEach` runs even when the test fails.

## Your Turn

Pick one of these patterns and find it in another part of the codebase. Does our server code validate URLs? Do we clean up every resource we open? Where else might a promise hang?

Look at the code you wrote last week. What would you change?

> "Knowledge emerges only through invention and reinvention, through the restless, impatient, continuing, hopeful inquiry human beings pursue in the world, with the world, and with each other." Paulo Freire
