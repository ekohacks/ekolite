# Closures: A Show and Tell

> At the dojo we understand what our tools do. We do not just use them. We know how they work.

## What is a closure?

A closure is when a function remembers variables from the place where it was defined, even after that place has finished executing.

That is it. That is the whole concept.

## Show me

Open `tests/client/clientSocket.integration.test.ts` and look at this:

```ts
describe('ClientSocket auth', () => {
  const PORT = 9878;

  function createAuthServer(): WebSocketServer {
    return new WebSocketServer({
      port: PORT, // <-- where does PORT come from?
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
    const client = ClientSocket.create(`ws://localhost:${String(PORT)}`);
    // ...
  });
});
```

`createAuthServer` is defined inside the `describe` block. `PORT` is defined in the `describe` block. The function uses `PORT` even though `PORT` is not a parameter and not defined inside the function.

That is a closure. `createAuthServer` "closes over" the variable `PORT`.

## Why should I care?

Because closures are everywhere in JavaScript and you are already using them. Every callback you have ever written inside a function is probably a closure.

### Example 1: Event handlers

```ts
this.socket.onopen = () => {
  resolve(); // resolve comes from the enclosing Promise constructor
};
```

`resolve` is not defined inside the arrow function. It comes from the `new Promise((resolve, reject) => { ... })` that wraps it. The arrow function closes over `resolve`.

### Example 2: The settled guard

```ts
connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;                    // defined here

    this.socket.onopen = () => {
      if (!settled) {                       // used here
        settled = true;                     // mutated here
        resolve();
      }
    };

    this.socket.onerror = (err) => {
      if (!settled) {                       // and here
        settled = true;                     // and here
        reject(new Error(err.message));
      }
    };
  });
}
```

Two separate functions (`onopen` handler and `onerror` handler) both close over the same `settled` variable. When one sets it to `true`, the other sees the change. They share the same variable, not a copy of it.

**Question:** What would happen if each function got its own copy of `settled` instead of sharing the same one? Would the race condition guard still work?

### Example 3: The OutputTracker

```ts
export class OutputTracker {
  private _data: unknown[] = [];

  constructor(emitter: EventEmitter, eventType: string) {
    emitter.on(eventType, (data: unknown) => {
      this._data.push(data); // this arrow function closes over `this`
    });
  }
}
```

The callback passed to `emitter.on` will fire later, possibly much later, long after the constructor has returned. But it still has access to `this._data` because the arrow function closes over `this` from the constructor scope, and then accesses `_data` as a property on it. Arrow functions do not have their own `this`. They always use the one from where they were defined.

## The mental model

Think of it like a backpack. When a function is created, it packs up all the variables from its surrounding scope and carries them along. Wherever that function goes, whatever calls it, it still has its backpack.

```
┌─────────────────────────────────────┐
│ describe('ClientSocket auth')       │
│                                     │
│   const PORT = 9878                 │
│                                     │
│   function createAuthServer() {     │
│     ┌─────────────┐                │
│     │  backpack:   │                │
│     │  PORT = 9878 │                │
│     └─────────────┘                │
│     return new WebSocketServer({    │
│       port: PORT   // from backpack │
│     });                             │
│   }                                 │
│                                     │
└─────────────────────────────────────┘
```

## Common traps

### Trap 1: The loop variable

```ts
// broken
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100);
}
// prints: 3, 3, 3 (not 0, 1, 2)
```

Why? All three arrow functions close over the same `i`. By the time they run, the loop is done and `i` is 3.

```ts
// fixed with let (block scoped, each iteration gets its own)
for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100);
}
// prints: 0, 1, 2
```

**Question:** Why does `let` fix this but `var` does not? What is the difference in scoping?

### Trap 2: Accidental memory leaks

If a closure holds a reference to a large object, that object cannot be garbage collected as long as the closure exists.

```ts
function setup() {
  const hugeArray = new Array(1_000_000).fill('data');

  return () => {
    console.log(hugeArray.length); // hugeArray lives forever now
  };
}

const leakyFn = setup();
// setup() finished, but hugeArray is still in memory
// because leakyFn's closure holds a reference to it
```

**Question:** How would you fix this? When is it OK and when is it a problem?

## Try it yourself

1. Open a Node REPL (`node` in your terminal)
2. Read the code below and predict the output before running it. Write your predictions down. Then type it in:

```js
function makeCounter() {
  let count = 0;
  return {
    increment: () => ++count,
    getCount: () => count,
  };
}

const counter = makeCounter();
console.log(counter.getCount()); // what does this print?
counter.increment();
counter.increment();
console.log(counter.getCount()); // what about this?
```

3. Now make a second counter: `const counter2 = makeCounter()`. Does incrementing `counter2` affect `counter`? Why or why not?

## The one sentence version

A closure is a function that remembers the variables from where it was born.

Every time you write a callback, an event handler, or a function inside another function, you are using closures. Now you know what to call it.

> At EkoHacks we do not just write code that works. We understand why it works.
