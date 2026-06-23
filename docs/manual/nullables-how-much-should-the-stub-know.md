# Nullables: how much should the stub know?

Every Nullable wrapper answers one question, and it answers it badly by default.
When you write `createNull()`, the embedded stub standing in for the real
dependency has to decide how much of that dependency's behaviour to reproduce.
Too little and every test has to script its own answers by hand. Too much and you
have quietly rebuilt the dependency inside your test double, so your tests now
pass against a thing that is not the thing.

This note is how we make that call. It leans on James Shore's _Testing Without
Mocks_ and on three wrappers we already ship: `ScriptRunnerWrapper`,
`MongoWrapper` and `FileStorageWrapper`.

## The words we use

- **Nullable**: a wrapper with a `create()` that talks to the real world and a
  `createNull()` that does not, while behaving the same to the code above it.
- **Embedded Stub**: the thin stand-in for the third party (the fs module, the
  Mongo driver, a child process) that `createNull()` runs against. It should stub
  the third party, not our own logic, and it should stay thin.
- **Configurable Responses**: you hand the Null the answers a read should give.
- **Output Tracking**: you record what the code sent outward. In our code that is
  `trackChanges()` returning an `OutputTracker`.
- **Behaviour Simulation**: the Null holds state and reproduces how the real thing
  behaves over a sequence of calls. This is the powerful, dangerous one.

## The two cheap tools

Split every wrapper method by direction.

- A method that sends something **out** to the world is an output. Test it with
  Output Tracking. `save`, `remove` and `exec` are outputs.
- A method that reads something **in** is an input. The default tool is a
  Configurable Response.

Reach for these first. They never drift, because the Null is not pretending to
reproduce behaviour, you are stating it.

## The expensive tool: Behaviour Simulation

Sometimes the code under test does `save`, then later asks `exists`, and expects
the second to reflect the first. A Configurable Response can express that, but
only by scripting each answer in call order, which is brittle and stops the test
from actually exercising the save. The realistic alternative is to give the Null a
small amount of state so the behaviour emerges. That is Behaviour Simulation.

It is worth it only when it stays honest. The trap is the slide from "a little
state" into "a reimplementation of the dependency", at which point you are testing
your reimplementation and it can disagree with reality without anyone noticing.

## The discriminator

> Simulate state only when a faithful model needs no reimplementation of the
> dependency's own logic.

Concretely: to answer a read correctly off prior writes, would the stub have to
rebuild how the real system matches or queries? If yes, do not hold the state. If
the model is a plain lookup, a small store is fine. Three cases from our own code
show the line.

### ScriptRunner holds no state

`exec(command, args)` runs a process and returns its output. There is no "read
back what I ran" call, so there is nothing to simulate. The Null uses Configurable
Responses keyed by command for what `exec` returns, and Output Tracking for the
execution it emitted. No store. This is the easy case.

### Mongo holds state, but in production, not in the stub (#60)

A client subscription needs to know which documents it already holds, so it only
forwards a `remove` for one it was sent. That is real state, but it lives in the
production logic, the `documentIds` set in `Publications`, gated by
`if (documentIds.delete(change.id))`. The Mongo stub itself stays dumb. We
deliberately refused a `Map` store there, because Mongo's reads are queries, and a
store that answered `find(query)` faithfully would have to reimplement Mongo's
query matching. That is rebuilding the dependency. Instead the stub echoes the
`_id` it is handed (`idFrom(source)`), which buys the one property the tests need,
correlating an insert with a later remove, for a few lines and no state.

### FileStorage holds a small store, keyed like reality (#61)

The filesystem at this interface is `save`, `exists` and `remove` by name. There
is no query language. A directory of named bytes simply **is** a
`Map<string, Buffer>`, so the model is faithful without reimplementing anything.
That is why FileStorage earns a store where Mongo does not. The same Shore rule,
"do not reimplement the dependency", points the opposite way only because the
dependency is different.

One detail decides whether the store is faithful or a quiet lie: **key it by the
same thing the real adapter keys by**. The real adapter writes to the resolved
absolute path, so the Null must too.

```ts
// null
writeFile(name: string, data: Buffer): Promise<void> {
  this.saveResponses?.next();
  this.store.set(this.resolve(name), data); // resolved, exactly like the real fs
  this.emitter.emit(CHANGE_EVENT, { type: 'save', name, data });
  return Promise.resolve();
}
```

Key it by the raw `name` instead and `save('./a.bam')` then `exists('a.bam')` is
`true` on a real disk and `false` in the Null. The Null and reality have parted
ways, and every green test that touches it is now lying to you.

The configurable options here are **fault injection only**, typed `Error[]`: an
`Error` in a queue is thrown by that operation, while the boolean comes from the
store. The type stops anyone passing `exists: [true]` and expecting it to force
the answer.

## The safety net: one contract, two adapters

A Null is a claim about the real thing. The only way to keep a claim honest is to
check it against the real thing, so any Behaviour Simulation must be pinned by a
shared **contract**: one list of scenarios, run against both `create()` and
`createNull()`. If the two ever disagree, a test fails.

```ts
// tests/infrastructure/fileStorageContract.ts
export function fileStorageContract(makeStorage: () => FileStorageWrapper): void {
  it('treats names that resolve to the same path as one file', async () => {
    const storage = makeStorage();
    await storage.save('./report.bam', Buffer.from('content'));
    expect(await storage.exists('report.bam')).toBe(true);
  });
  // ...saved-then-exists, removed-then-gone, empty-name rejected
}
```

Run it against the Null in the fast unit suite, and against a real temp directory
in the integration suite. The path scenario above is the one that caught the raw
versus resolved drift: it fails on a raw keyed Null and passes once the Null keys
the way reality does. That single test is what makes the store safe to keep.

This is also the honest answer to "do we still need integration tests". Yes, but
only narrow ones, at the wrapper boundary, and a contract is the sharpest form of
them: it is the thing that stops a Null drifting from the dependency it imitates.
Everything above the infrastructure layer uses Nullables and gets no integration
tests.

## Checklist for a new Nullable

1. Output method (sends outward)? Output Tracking, no state.
2. Input method (reads)? Start with a Configurable Response.
3. Does the code rely on read reflecting prior writes? Only then consider a store.
4. Would a faithful store have to reimplement the dependency's query or match
   logic? If yes, keep the stub dumb and echo just the identity you need (see
   Mongo). If it is a plain lookup, a small store is fine (see FileStorage).
5. Holding state? Key it exactly as the real adapter does, and pin it with a
   contract run against both real and Null. No contract, no behaviour simulation.
