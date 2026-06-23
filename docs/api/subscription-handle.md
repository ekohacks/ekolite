# SubscriptionHandle

`SubscriptionHandle` is what [`ConnectionManager.subscribe`](./connection-manager.md)
returns. It is the reader's grip on a single subscription: a promise that tells
you when the first data has arrived, and a way to stop the subscription when you
are done with it.

```ts
export interface SubscriptionHandle {
  stop(): void;
  ready: Promise<void>;
}
```

## Members

- **`ready: Promise<void>`** — resolves once the server has sent the initial
  documents and its `ready` signal for this subscription. Rejects if the server
  returns an error for it (for example an unknown publication), or if the
  subscription is stopped before it ever became ready. Await it before reading
  the store so your first render has the initial data.
- **`stop(): void`** — unsubscribes. Sends an unsubscribe message to the server
  and drops the subscription on the client. Call it when the component that owns
  the subscription unmounts. Safe to call before `ready` has resolved; doing so
  rejects the pending `ready` promise.

## See also

- [`ConnectionManager`](./connection-manager.md) — creates handles and the stores
  they feed, with a full worked example.
