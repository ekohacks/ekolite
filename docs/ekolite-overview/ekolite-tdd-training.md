# Test-Driven Development in EkoLite

Every line of EkoLite was written test first, and there is no mocking library in the project. This walks through how that works in practice, using two pieces of the framework as they were actually built.

Start with [ekolite-overview.md](ekolite-overview.md) if you want the big picture first. [The TDD engineering guide](ekolite-tdd.md) is the reference behind this tour: the wrappers, their signatures, and how contract tests keep a nulled wrapper honest. And [nullables-how-much-should-the-stub-know.md](../manual/nullables-how-much-should-the-stub-know.md) takes on the design question that comes up most once you start writing nulled infrastructure of your own.

---

## 1. Red, Green, Refactor

Every piece of production code starts with a failing test. The loop has three phases.

**Red.** Write a test that describes the behaviour you want. Run it. It must fail. If it passes, either you wrote the wrong test or the behaviour already exists, and both are worth knowing before you write any code.

**Green.** Write the simplest, dullest code that makes the test pass. No cleverness, no "while I am here" additions. Just make the red go green.

**Refactor.** Now the test is green, improve the structure. Rename, extract, remove duplication. The tests stay green throughout. If they go red you changed behaviour, so undo and try again.

A cycle should take five to twenty minutes. If you have been in red for half an hour, the test is too ambitious. Write a smaller one.

---

## 2. How This Works Without Mocks

EkoLite follows [Testing Without Mocks](https://www.jamesshore.com/v2/projects/nullables/testing-without-mocks). There is no `vi.mock()` and no `vi.spyOn()` anywhere in the suite.

Every infrastructure wrapper has two factories. `create()` connects to the real thing: MongoDB, the file system, a WebSocket server. `createNull()` returns an in-memory one behind the identical interface. Logic classes take their infrastructure through the constructor and cannot tell which kind they were handed.

So a logic test instantiates the real logic class with nulled infrastructure, and everything that runs is real code. Nothing is stubbed out at the seams.

### Output tracking replaces spies

| Traditional                                 | Nullable                                   |
| ------------------------------------------- | ------------------------------------------ |
| `vi.spyOn(ws, 'send')`                      | `ws.trackMessages()`                       |
| `expect(ws.send).toHaveBeenCalledWith(...)` | `expect(client.messages).toContainEqual()` |

A spy asks whether a function was called. Output tracking asks what was produced. The second question survives a refactor, the first one does not.

### The kinds of test in this project

| Kind               | What it tests                                          | Real systems?  | Speed |
| ------------------ | ------------------------------------------------------ | -------------- | ----- |
| Narrow integration | An infrastructure wrapper against real Mongo, fs or ws | Yes            | Slow  |
| Parity             | The nulled wrapper behaves like the real one           | Yes, runs both | Slow  |
| Sociable           | Logic against nulled infrastructure                    | No             | Fast  |
| Client             | ReactiveStore, subscriptions, calls, uploads           | No             | Fast  |

Nullable tests and integration tests live in separate files, so the fast suite never touches the network or the disk.

---

## 3. The Mistakes That Cost the Most Time

| Mistake                            | Why it hurts                                                                 | Instead                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| Reaching for `vi.mock()`           | Breaks the nullable contract and hides the real behaviour                    | Write a `createNull()` with seed data                    |
| Writing the code before the test   | You cannot know a test tests the right thing if you never saw it fail        | Always start red                                         |
| Being clever in green              | Green and refactor are two jobs. Doing both at once means doing neither well | Write the dullest code that passes                       |
| Skipping refactor because it works | The whole reason green is allowed to be dull is that refactor comes next     | Take the step, even if the answer is "nothing to change" |

---

## 4. Worked Example: Methods

`Methods` is the simplest logic class in the framework and it has no infrastructure at all, which makes it the clearest place to see the loop.

### Cycle 1: define and call

**Red.** The test comes first, in `tests/logic/methods.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Methods } from '../../server/logic/methods.ts';

describe('Methods', () => {
  it('registers and calls a method', async () => {
    const methods = new Methods();
    methods.define('echo', (msg) => Promise.resolve(`echo: ${String(msg)}`));

    const result = await methods.call('echo', ['hello']);

    expect(result).toBe('echo: hello');
  });
});
```

It fails: the module does not exist. That is red, and it is the right kind of red. The test says what we want before anything can possibly provide it.

**Green.** The dullest thing that passes:

```ts
export class Methods {
  private methods = new Map<string, MethodFn>();

  define(name: string, fn: MethodFn): void {
    this.methods.set(name, fn);
  }

  async call(name: string, args: unknown[]): Promise<unknown> {
    const method = this.methods.get(name);
    return method(...args);
  }
}
```

A map of functions by name. Nothing more.

### Cycle 2: the unknown method

**Red.** What happens when nobody defined it?

```ts
it('throws structured error for unknown method', async () => {
  const methods = new Methods();

  await expect(methods.call('nope', [])).rejects.toMatchObject({
    code: 404,
    message: 'Method not found: nope',
  });
});
```

This fails on `method is not a function`, because the map returned `undefined` and we called it anyway. Red again, and note what the test just did: it found a real hole in the code we just wrote, which is exactly what it is for.

**Green.** A guard:

```ts
async call(name: string, args: unknown[]): Promise<unknown> {
  const method = this.methods.get(name);
  if (!method) {
    throw methodNotFound(name);
  }
  return method(...args);
}
```

**Refactor.** `methodNotFound` moves to `shared/types.ts`, next to the error shape it builds, because the client needs to recognise that error too and both ends should agree on it in one place.

The class in the repo today is those two cycles plus one more, which refuses to redefine a method that already exists. Three tests, three behaviours, and every one of them failed before it passed.

---

## 5. Worked Example: Publications, With Nulled Infrastructure

`Publications` depends on MongoDB and a WebSocket server. This is where mocking is the usual reflex, and where nullables earn their keep.

**Red.** No mocks. Real `Publications`, nulled infrastructure with seed data:

```ts
import { Publications } from '../../server/logic/publications.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

it('sends error when subscribing to unknown publication', async () => {
  const mongo = MongoWrapper.createNull();
  const ws = WebSocketWrapper.createNull();
  const client = ws.simulateConnection();
  const pubs = new Publications(mongo, ws);

  await pubs.handleMessage(client.id, {
    type: 'subscribe',
    id: 'sub1',
    name: 'nonexistent',
  });

  expect(client.messages).toContainEqual({
    type: 'error',
    id: 'sub1',
    error: { code: 404, message: 'Unknown publication: nonexistent' },
  });
});
```

Read what that test is made of. `MongoWrapper.createNull()` is a real MongoWrapper with an in-memory store behind it. `ws.simulateConnection()` hands back a stubbed client that records what was sent to it. `Publications` is the real class, running its real code. The only thing that is not real is the database and the socket, and they are not stubs of MongoWrapper, they are MongoWrapper.

The assertion is about what came out, `client.messages`, not about which functions were called on the way. That is the difference that matters. Rename a private method tomorrow, and this test does not notice.

For the happy path the nulled Mongo carries seed data:

```ts
const mongo = MongoWrapper.createNull({
  find: [[{ _id: '1', name: 'existing.bam' }]],
});
```

Subscribe, and the client receives an `added` for the document and a `ready` to say the initial set is complete. Same structure, no mocks, and it runs in milliseconds because nothing leaves the process.

---

## 6. Why This Holds Up

The tests in this repository survived a series of refactors that would have destroyed a spy-based suite: infrastructure wrappers rewritten to the nullable pattern one at a time, the shutdown path rebuilt around `AsyncDisposableStack`, the whole graph pulled into an `App` class. Behaviour was asserted, not implementation, so the tests kept telling the truth while the code underneath them moved.

That is the return on writing them this way, and it does not show up on the day you write them. It shows up on the day you change your mind.
