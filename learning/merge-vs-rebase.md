# Merge vs Rebase: The Day a Silent Merge Broke Our Branch

> "Dialogue cannot exist without humility. How can I dialogue if I always project ignorance onto others and never perceive my own?" Paulo Freire

At EkoHacks we do not tell you which git workflow to use. We show you the moment a workflow stopped serving us, ask what we could see, and let you decide when to reach for each one yourself.

## The setup

EKO-265 had been running for a couple of days. Gochi had been adding `ConfigurableResponse` to `FileStorage` and `ScriptRunner`. Meanwhile two other PRs merged to main: EKO-267 renamed every wrapper class and interface, and EKO-260 refactored `createServer` to take an injected wrapper.

To catch the branch up, we ran a merge: `git fetch && git merge origin/main`. Conflicts popped up, we worked through them, tests passed locally, commit landed.

`npx tsc --noEmit` said otherwise.

## What broke

Three errors. All from the same category of conflict, resolved silently by the merge tool.

```
server/infrastructure/fileStorage.ts(3,67): Cannot find module './output_tracker.ts'.
```

Main had renamed `output_tracker.ts` to `outputTracker.ts` during EKO-267. The merge kept our branch's old import.

```
server/infrastructure/scriptRunner.ts(57,39): Cannot find name 'ProcessRunnerInterface'.
```

Main had renamed `ProcessRunnerInterface` to `ScriptRunnerInterface`. The merge kept our branch's old reference.

```
tests/infrastructure/scriptRunner.test.ts(13,7): Type 'string[]' is not assignable to type 'string'.
```

Our tests had been updated to pass arrays to `createNull`, reflecting the new ConfigurableResponse shape. But `createNull`'s outer signature still read `Record<string, string>`. The merge took the test changes and kept the old production signature. Tests and production code pointing at different worlds, inside the same branch.

**Question for the pair:** how does a merge leave a single branch where one file expects arrays and another file expects strings? Why did no human see that happen?

## What the merge did

A merge takes two diverged histories and produces one combined state. The tool walks through every file, sees "both sides changed this", and tries to resolve. If it can find a clean three-way merge, it takes it. If not, it raises a conflict marker.

Here is the subtle bit. The tool resolves each file in isolation. It does not know that `scriptRunner.ts` and `scriptRunner.test.ts` are supposed to agree with each other. It looks at each file's diff against the common ancestor, picks whatever resolution it thinks is cleanest, and moves on. Across fourteen changed files in our branch and six on main, there are hundreds of tiny decisions like this. The merge commit captures them all at once. You never see the individual ones.

The result is a working tree that "merges" but does not cohere. Tests and production code can end up pointing at different worlds because nobody asked the question "do these changes still fit together?" at each decision point.

## What a rebase would have done

A rebase is the opposite workflow. It takes your commits off your branch, fast forwards to the latest main, and then replays your commits one at a time on top.

At each commit, if the replay conflicts with what is now on main, git stops. You stand inside that specific commit. The conflict is shown in the context of _that one change_, not the cumulative diff of your whole branch.

On our branch it would have looked like this.

Commit one: `fileStorage: emitter and configurable response`. Replay. Git stops. "You added an import from `./output_tracker.ts`, but that file was renamed to `./outputTracker.ts` on main. Decide." You fix the import, `git add`, `git rebase --continue`.

Commit two: `scriptRunner: configurable response`. Replay. Git stops. "You renamed a type to `ScriptRunnerResponses` and used it in `createNull`'s signature, but main has renamed `ProcessRunnerInterface` to `ScriptRunnerInterface` in the same file." You fix both references, `git add`, `git rebase --continue`.

Commit three: `tests/scriptRunner: array responses`. Replay. Clean, because commit two was resolved in a way that made commit three fit. Or if it is not clean, git stops and you see exactly why, with commit two's resolution as context.

At every stop you see the small decision, in the context of the change that caused it. You cannot accidentally let tests and production drift apart because the conflict surfaces on the commit that introduced the drift. The mismatch we found after our merge would have been impossible: git would have asked us about it before we got there.

## The mechanics

On your branch, with nothing staged:

```
git fetch origin
git rebase origin/main
```

If a conflict comes up, fix the files, stage, continue:

```
git add path/to/file
git rebase --continue
```

If you want to bail:

```
git rebase --abort
```

Because rebase rewrites history, your local branch now differs from origin. A plain `git push` will refuse. Use:

```
git push --force-with-lease
```

The `--force-with-lease` flag refuses to push if someone else has pushed to the same branch while you were rebasing, so you cannot blow away a teammate's commits by accident. Safer than plain `--force`, which does not check.

## When to reach for which

Not every pull from main wants a rebase. The trade off is real.

Reach for **merge** when your branch is short lived and the risk of silent combining is low. Small fix, few files, you will be reviewing the diff yourself anyway. The merge commit in history is not a problem.

Reach for **rebase** when your branch has been living parallel to main for more than a day or two, or when main has done something invasive (renames, moves, refactors) that changed files you also changed. Rebase makes you confront each decision as a small thing, on the commit where it arose, while the change is still fresh.

The question underneath the choice is: how much do I want to see versus how much am I willing to let the tool decide? Merge delegates the decisions. Rebase demands them. Different moments of work want different answers.

## What we carry forward

**Silent merges hide decisions.** The tool makes them, you do not see them, and sometimes the decisions are wrong in ways that take hours to notice. Today they cost us half an hour of type checking and two round trips through the test suite.

**Rebase makes you walk through each conflict in context.** More work at the moment, less work later. The mismatch gets caught at the point it was introduced, not days later when the tests refuse to compile.

**Neither is always right.** The choice depends on how long your branch has been parallel to main and how invasive main has been. A quick fix of a tiny file probably wants a merge. A feature branch that has been running for a week, touching files that main has also been refactoring, wants a rebase.

The discipline is noticing which situation you are in. The tool will not tell you. Your teammates will not tell you. You decide, by asking: if this combines silently, what could break without anyone seeing it?

If you cannot quickly answer, rebase. You will see what you would have missed.
