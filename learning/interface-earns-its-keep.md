# The Interface Test: Delete It and See What Breaks

> "Liberating education consists in acts of cognition, not transferrals of information." Paulo Freire

At EkoHacks we do not hand down rules about when to reach for an interface. We show you a moment one earned its keep, a moment one didn't, and a single experiment you can run that makes the difference visible without anyone having to tell you.

## The setup

EkoLite leans on the nulled infrastructure pattern. Every piece of IO gets a wrapper. `MongoWrapper`, `WebSocketWrapper`, `FileStorageWrapper`, `ScriptRunnerWrapper`. Each wrapper has a real implementation that talks to the outside world and a null implementation that fakes it in memory. Tests construct the null side, production constructs the real side. Same surface, different bodies.

The glue that makes the swap work is a TypeScript interface. Open `server/infrastructure/mongo.ts` and look at the top of the file:

```ts
interface MongoInterface {
  find<T>(collection: string, query: object): Promise<T[]>;
  insert(collection: string, doc: object): Promise<void>;
  update(collection: string, query: object, changes: object): Promise<void>;
  remove(collection: string, query: object): Promise<void>;
  trackChanges(collection: string): OutputTracker;
}

class RealMongo implements MongoInterface {
  /* talks to MongoDB */
}
class StubbedMongo implements MongoInterface {
  /* holds a Map */
}
```

Two implementations, one contract. The wrapper holds one of them without knowing which. That is the pattern.

## How the interface earns its keep

Delete `MongoInterface` from that file. Nothing in the test suite immediately fails, which looks like the interface is decorative. It isn't.

Two protections live here, both at the TypeScript compile level.

**Drift catches at compile time.** Add a new method `count(query)` to `MongoInterface` and forget to add it to `StubbedMongo`. `tsc` refuses to compile:

```
Class 'StubbedMongo' incorrectly implements interface 'MongoInterface'.
Property 'count' is missing in type 'StubbedMongo' but required in type 'MongoInterface'.
```

Same if someone changes the signature of `find` on one side only. The interface keeps both implementations in lockstep. Without it, the real and null sides drift apart silently and the bug lands in production.

**No "passes in tests, breaks in production" failures.** The wrapper field is typed `private client: MongoInterface`, not one of the concrete classes. So the wrapper can only call methods the interface declares, which means methods both implementations have. A test that exercises the wrapper through the null side cannot quietly rely on a method only the real side implements. The entire class of bug where the test passes against the stub and then fails against the real thing, because one side has a method the other does not, does not compile.

That is the protection. Two genuinely different implementations, one contract.

## And a case where it does not

Last week we added a `Publications` class at `server/logic/publications.ts` as part of EKO-232. Not infrastructure, domain. A class that takes an already wrapped `MongoWrapper` and `WebSocketWrapper` through its constructor and handles client subscribe messages.

The first draft carried a `PublicationInterface` alongside the `Publications` class:

```ts
interface PublicationInterface {
  define(name: string, queryFn: PublicationDef): void;
  handleMessage(clientId: string, message: ClientMessage): Promise<void>;
}

export class Publications implements PublicationInterface {
  // ...
}
```

One implementer. Same shape on the class, restated on the interface above it.

**Try this in your editor.** Check out PR #26 at commit `cee7790`. Open `server/logic/publications.ts`. Delete the `interface PublicationInterface` declaration and strip `implements PublicationInterface` from the class line. Save. Run the one publication test:

```
✓ tests/logic/publications.test.ts (1 test) 3ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

Green. Not one assertion cared.

Now run `tsc --noEmit`. No new errors. The only warning is the pre-existing `mongo declared but never read`, which is scaffolding for the next story and has nothing to do with the deletion.

## Why it came out decorative

Walk it through. `MongoInterface` earns its keep because there is a genuine choice between `RealMongo` talking to the wire and `StubbedMongo` holding a map. The bodies are completely different, the signatures have to agree, and the interface is what forces them to agree.

`Publications` has no equivalent choice. There is no "real body" and "stubbed body" for `handleMessage`. There is one algorithm, and the IO it depends on was already swapped one layer down, inside `MongoWrapper` and `WebSocketWrapper`. Publications does not wrap anything. It consumes things that wrap.

An interface with one implementer is a contract with one party. The job an interface does, keeping two implementations in lockstep, is not a job there is to do.

## The tempting wrong turn

There is a longer route to this insight that we walked on PR #26 before we arrived at the short one. It starts from the question "when does an interface earn its keep", which can be answered two ways.

The honest answer: when there is a swap between two genuinely different bodies.

The tempting answer: when there are two implementations. So add a second implementation and the interface earns its keep.

The tempting answer is how a class called `StubbedPublication` ends up carrying the exact same code any "real" implementation would carry, because the IO swap you thought you needed has already happened inside `MongoWrapper` and `WebSocketWrapper` one layer below. Two classes, one body. A contract with one party wearing two hats.

The short answer, delete the interface and run the tests, skips the wrong turn entirely. The fact is empirical. The test suite is the authority. You do not have to be convinced by a reviewer, you just have to try it.

## The test you can apply anywhere

In any TypeScript codebase, not just EkoLite:

> Find the interface. Delete it. Run the tests and the build. If nothing fails, the interface is either decorative or protecting something there is no test for yet. Either way, it is not earning its keep.

The ones that survive the test are the ones holding two implementations in lockstep.

**Question for the pair.** When you last added an interface to a TypeScript file, was it protecting a swap? If you deleted it today, what would break, and where is the evidence?
