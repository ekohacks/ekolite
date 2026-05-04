# The Closure Inside Your useEffect

> 'Authentic education is not carried on by A for B or by A about B, but rather by A with B.' Paulo Freire

You have written this. So have we.

```ts
useEffect(() => {
  const sub = source.subscribe(handleData);
  return () => sub.unsubscribe();
}, []);
```

The docs say to return a function and React will call it on unmount, so you do, your component leaks no listeners, and you move on. The cleanup looks like a React idiom. A small piece of choreography you trade for a clean teardown.

Then we read this, in the protocol layer of EkoLite:

```ts
watchChanges(collection: string, cb: (change: ChangeEvent) => void): () => void {
  const listener = (data: unknown) => {
    if (isChangeEvent(data)) cb(data);
  };
  this.emitter.on(collection, listener);
  return () => {
    this.emitter.off(collection, listener);
  };
}
```

Same shape. A function returning a function, with the caller expected to hold the returned function and call it later. No React anywhere. No `useEffect`. The cleanup pattern with the React filed off.

We sat with it for a while because something did not add up. The shape was identical, and yet React was not here to call the cleanup. So who was, and what was actually inside the cleanup that made it work?

The answer is the closure. Once we had traced what the closure was carrying, `useEffect` cleanup looked different too.

## What is not the same

Look closer at the body. There is `cb`, which is what the caller passed in. There is `listener`, which is something the function makes up on the spot:

```ts
const listener = (data: unknown) => {
  if (isChangeEvent(data)) cb(data);
};
```

`listener` is a wrapper. It exists because the emitter speaks `(data: unknown) => void` and the caller's callback expects a typed `ChangeEvent`. Something has to bridge those signatures. The wrapper does the bridging.

Now the registration:

```ts
this.emitter.on(collection, listener);
```

The wrapper goes onto the emitter's list. Not `cb`. The caller's `cb` never touches the emitter. The thing the emitter knows about is `listener`.

Emitters identify listeners by reference. To remove one, you pass back the same function reference you registered. Pass anything else and nothing happens. Open `outputTracker.ts` and read it for yourself:

```ts
off(eventType: string, handler: (data: unknown) => void): void {
  const handlers = this.handlers.get(eventType);
  if (handlers) {
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
    }
  }
}
```

`indexOf` looks for a matching reference. No match, no removal.

Follow the trail. The caller has `cb`. The caller does not have `listener`, never saw it, never will. The wrapping happened inside `watchChanges`, and `listener` is a local variable that goes out of scope the moment the function returns.

How does the caller ever ask for that wrapper to come off?

## The closure is the answer

The function does one more thing before it returns:

```ts
return () => {
  this.emitter.off(collection, listener);
};
```

The arrow captures `listener` from the surrounding scope. When the caller invokes it later, `listener` is still the same reference. The closure is the only path back to the wrapper. Without it, the wrapper is orphaned, registered with the emitter forever, called every time the event fires, with nobody able to take it off.

That is the work the closure is doing here. Not the textbook version about lexical scoping in the abstract. The concrete version: holding the only remaining reference to a function the caller could never reach by any other means.

## What this lets us see in useEffect

Go back to React.

```ts
useEffect(() => {
  return watchChanges('files', handleChange);
}, []);
```

The function React stores on mount is the same closure we just looked at. It still has `listener` inside it. On unmount, React invokes that closure. The wrapper comes off. The unsubscribe works.

So `useEffect` cleanup is not a React mechanism with magic inside. The magic was always the closure. React's only job is to remember the function and invoke it at the right time. The function itself, the thing that actually knows how to undo the subscription, is doing exactly what it would do anywhere else.

The shift was small but it changed everything. We had thought of cleanup as a React idiom you returned to keep React happy. Once we had seen `watchChanges`, cleanup became a closure pattern that React happens to hook into.

## A test that locks it in

There are two halves to this contract worth pinning down. The cleanup must remove what was registered. And it must remove only what was registered.

```ts
it('removes only the listener it registered', () => {
  const mongo = MongoWrapper.createNull();
  const calls = { a: 0, b: 0 };

  const offA = mongo.watchChanges('files', () => {
    calls.a++;
  });
  mongo.watchChanges('files', () => {
    calls.b++;
  });

  offA();

  await mongo.insert('files', { name: 'thing.bam' });

  expect(calls.a).toBe(0);
  expect(calls.b).toBe(1);
});
```

If anyone ever rewrites the cleanup to use `cb` instead of `listener`, this test flips red. The closure is not decoration. It is load bearing.

## A move you can run on any subscribe API

Pick any function in your codebase that returns a cleanup function. Open it. Find what gets registered with the underlying source. Ask one question.

Is the thing that gets registered the same thing the caller passed in? If yes, you do not strictly need the closure. The caller could call `off(cb)` themselves. If no, the closure is doing real work and removing it would silently break cleanup.

In `watchChanges`, the answer is no. `listener` is registered. `cb` is held inside `listener`. The closure is the only bridge.

In `addEventListener`, the answer is yes. The function the caller registers is the function the producer attaches. So the caller has to keep their own reference and pass it back later. Many bugs in DOM event handling come from callers wrapping their handler ('let me bind this' or 'let me debounce that') and then trying to remove the original. The wrapped version is on the element, not the original.

The closure-as-cleanup pattern fixes that whole category. The producer wraps freely. The caller gets one button to press later. They do not need to know what was wrapped or how.

## The reproducible move

Next time you read a function that returns a function, ask what the inner one remembers. If the answer is 'a value the caller could never reach any other way', the closure is doing real work. Name it as such.

You will start seeing the same shape in `setTimeout` cancellation when an id comes back, in `AbortController` signals, in observable subscriptions, in any 'here's a button to undo what I just did' API. `useEffect` cleanup is the most familiar instance. It is not the only one, and it is not even the most interesting one.

We would love to hear from you about a place in your code where the closure surprised you. Tell us in the comments or on the EkoHacks channel.
