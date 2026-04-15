# Browser vs Node: Why Our Client Code Blew Up

> "To simply think about the people, as the dominators do, without any self-giving in that thought, is to deny them their right to think." Paulo Freire

At EkoHacks we don't hand you the answer and move on. We show you the broken thing, ask you why it's broken, and let you figure it out. That way when you see it next time, and you will, you don't need anyone to tell you.

## The error

Run `npm run dev:client`, open the browser, open DevTools (F12), check the Console. You'll see:

```
Failed to connect to server: TypeError: WebSocket is not a constructor
```

The app loads. The HTML renders. Then it tries to connect and falls over.

## Before you read on

Open `client/clientSocket.ts` and look at line 1. Then open the browser console and type `WebSocket`. Hit enter. Now type `require('ws')`. Hit enter.

**Question for the pair:** What did each of those return? Why is one a thing and the other isn't?

## The root cause

Line 1 was:

```ts
import { WebSocket, ClientOptions } from 'ws';
```

`ws` is an npm package. It's a WebSocket implementation for Node. It works beautifully in Node because Node didn't always have WebSocket built in. But the browser is not Node.

The browser already has `WebSocket`. It's a global. It's been there since 2011. You don't install it, you don't import it, it's just there. Type `WebSocket` in any browser console and you'll see it.

When Vite bundles `client/clientSocket.ts` for the browser, it sees `import { WebSocket } from 'ws'` and tries to resolve the `ws` package for the browser environment. It can't. `ws` depends on Node built ins like `net`, `http`, `stream`. None of those exist in the browser. So the import returns nothing. `WebSocket` is `undefined`. And `new undefined()` gives you `TypeError: WebSocket is not a constructor`.

**Question for the pair:** All our tests ran in vitest, which uses Node. The `ws` package was installed. Everything was green. How did we miss this?

## The fix

Remove the import. The browser already has what we need.

```diff
- import { WebSocket, ClientOptions } from 'ws';
```

That's it for the constructor error. But removing the import exposed three more things that were quietly wrong. Each one is a difference between the `ws` library API and the browser's native WebSocket API.

## Hidden problem 1: `.on('close')`

The old `close()` method:

```ts
close(): Promise<void> {
  return new Promise((resolve) => {
    if (!this.socket) {
      resolve();
      return;
    }
    this.socket.on('close', () => {
      resolve();
    });
    this.socket.close();
  });
}
```

**Stop and think.** Where does `.on()` come from?

`.on()` is a Node EventEmitter method. The `ws` library makes its WebSocket class extend Node's EventEmitter, so `socket.on('close', cb)` works in Node. But the browser's WebSocket is not an EventEmitter. It doesn't have `.on()`. It has `.onclose` and `.addEventListener()`.

**Try it.** Open the browser console:

```js
const ws = new WebSocket('ws://localhost:3001/ws');
console.log(typeof ws.on); // what does this print?
console.log(typeof ws.onclose); // what about this?
```

The fix:

```ts
close(): Promise<void> {
  return new Promise((resolve) => {
    if (!this.socket) {
      resolve();
      return;
    }
    this.socket.onclose = () => {
      resolve();
    };
    this.socket.close();
  });
}
```

**Question for the pair:** What is the difference between `socket.onclose = cb` and `socket.addEventListener('close', cb)`? What happens if you assign `onclose` twice? What happens if you call `addEventListener` twice? When would you pick one over the other?

## Hidden problem 2: `send(data, callback)`

The old `send()` method:

```ts
send(message: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!this.socket) {
      reject(new Error('Socket is not connected'));
      return;
    }
    this.socket.send(JSON.stringify(message), (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
```

**Stop and think.** The `ws` library's `send()` accepts a callback as the second argument. It calls the callback when the data has been flushed to the network buffer, or with an error if something went wrong. That's a Node pattern.

The browser's `send()` takes one argument: the data. No callback. It's synchronous. It either sends or it throws.

**Try it.** Open the browser console:

```js
const ws = new WebSocket('ws://localhost:3001/ws');
ws.onopen = () => {
  ws.send('hello', (err) => console.log('callback fired'));
  // does the callback fire?
};
```

The fix:

```ts
send(message: unknown): Promise<void> {
  if (!this.socket) {
    return Promise.reject(new Error('Socket is not connected'));
  }
  this.socket.send(JSON.stringify(message));
  return Promise.resolve();
}
```

**Question for the pair:** The old version wrapped `send()` in a Promise and used the callback to resolve or reject. The new version just calls `send()` and resolves immediately. What do we lose? If `send()` fails in the browser, how would we know?

## Hidden problem 3: `onerror` event shape

The old `onerror` handler:

```ts
this.socket.onerror = (err) => {
  if (!settled) {
    settled = true;
    reject(new Error(err.message satisfies string));
  }
};
```

**Stop and think.** The `ws` library fires `onerror` with an `ErrorEvent` that has a `.message` property. The browser fires `onerror` with a plain `Event`. No `.message`. No error details at all.

**Try it.** Open the browser console:

```js
const ws = new WebSocket('ws://localhost:99999');
ws.onerror = (e) => {
  console.log(typeof e.message); // what does this print?
  console.log(e); // what's actually in here?
};
```

The fix:

```ts
this.socket.onerror = () => {
  if (!settled) {
    settled = true;
    reject(new Error('WebSocket connection failed'));
  }
};
```

We lose the specific error message. That's a tradeoff. The browser intentionally hides WebSocket error details for security reasons (you shouldn't be able to probe internal network topology from JavaScript). So a generic message is the correct thing to do here.

**Question for the pair:** Why would the browser hide error details from JavaScript? Think about what a malicious script in a browser tab could learn if `onerror` told it exactly why a connection to an internal IP address failed.

## Hidden problem 4: the hardcoded URL

This one isn't a Node vs browser issue. It's just wrong. The old `main.ts`:

```ts
const client = ClientSocket.create('ws://localhost:9876');
```

Port 9876. The server runs on port 3001. And Vite's dev server proxies `/ws` to `ws://localhost:3001`. So the correct URL in the browser is relative to the current page:

```ts
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const url = `${protocol}//${window.location.host}/ws`;
```

This way the same code works in dev (Vite proxy) and production (direct).

**Question for the pair:** Why do we check `window.location.protocol` and swap between `ws:` and `wss:`? What is the relationship between `http`/`https` and `ws`/`wss`? What would happen if you used `ws:` on an `https:` page?

## The auth tests

There was also a change to the integration tests. The old auth tests did this:

```ts
const client = ClientSocket.create(`ws://localhost:${String(PORT)}`, {
  headers: { Authorization: 'Bearer test-token' },
});
```

`ClientSocket.create()` used to accept an options object as a second argument and pass it straight to the `ws` library's WebSocket constructor. That's how we sent auth headers.

But the browser's WebSocket constructor doesn't accept headers. The browser signature is `new WebSocket(url, protocols?)` where protocols is a string or array of strings. Not an options object. Not headers.

So the auth tests now use the `ws` library directly, because they're testing server side auth behaviour, not our `ClientSocket` class:

```ts
import { WebSocket as WsWebSocket } from 'ws';

const ws = new WsWebSocket(`ws://localhost:${String(PORT)}`, {
  headers: { Authorization: 'Bearer test-token' },
});
```

**Question for the pair:** If the browser's WebSocket can't send custom headers, how do real web apps authenticate WebSocket connections? There are at least three common approaches. See if you can find them. Think about cookies, query parameters, and what you could send as the first message after connecting.

## The big lesson

All our tests passed. Every single one. Green across the board. And the code was fundamentally broken in the environment where it actually needed to run.

This happened because the tests ran in Node (via vitest) and the code was written using the Node `ws` library. The tests and the production code were both speaking Node. They agreed with each other perfectly. But the production code was supposed to speak browser.

**Rule:** If a file lives in `client/`, it runs in the browser. Do not import server packages. If you're not sure whether something is a browser API or a Node API, check MDN for the browser version and the Node docs for the Node version. They are not the same thing, even when they have the same name.

**Question for the pair:** Can you think of other APIs where Node and the browser both have something with the same name but different behaviour? `fetch` is one. `setTimeout` is another. `URL` is another. Pick one and find a difference.

## Your turn

Open `server/infrastructure/websocket.ts` and look at how the server imports from `ws`. That's fine because the server runs in Node. Now open `client/clientSocket.ts` and check that nothing from Node has crept back in. Read every import. Ask yourself: does this exist in the browser?

Then run `npm run dev:client`, open the browser, open DevTools > Network > WS tab. Do you see a WebSocket connection? If you do, EKO-234 is one step closer to done done.

> At EkoHacks we don't just write code that passes tests. We make sure it works where it's supposed to work.
