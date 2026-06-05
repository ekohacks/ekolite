# Git Worktree: The Day We Wanted to Verify a Branch Without Leaving Our Own

> "Founding itself upon love, humility, and faith, dialogue becomes a horizontal relationship of which mutual trust between the dialoguers is the logical consequence." Paulo Freire

At EkoHacks we do not tell you to keep a clean main and stay out of each other's way. We show you the moment one of us needed to read the other's work and had to choose: take the seat they had been sitting in, or pull up a chair beside them.

## The setup

A branch had been live for a couple of days. A ClientSocket refactor, sitting on top of an in flight PR, with its own pile of tests and a coverage number to check.

We wanted to verify it. Pass or fail against six "Done when" criteria, the kind of thing you do before raising the PR or before approving someone else's. Not a glance. Run the unit suite, run the integration suite, get the coverage report, read three test files, decide.

The usual move is `git checkout the-branch`, look around, run the tests, then `git checkout main`. It works. It also means swapping every file in the editor, losing any uncommitted thinking we had sitting around, and treating our own work as a thing to be put away.

There is a smaller tool for this. Most of us never reach for it.

## What a worktree is

A worktree is a second checked out copy of the same repository, in a different folder, on a different branch. One repo. Two folders. Two branches loaded at the same time.

```
~/Sites/ekolite              folder one, on main
├── client/
├── server/
└── .git/                    the real repo (commits, refs, history)

/tmp/ekolite-pr39-verify     folder two, on the branch
├── client/                  (same paths, the other branch's content)
├── server/
└── .git                     a small pointer file back to folder one's .git/
```

The git database lives once, in your main checkout. The second folder carries a pointer back to it. So you are not duplicating history. You are opening a second window onto the same one.

## What we did

```
git worktree add /tmp/ekolite-pr39-verify the-branch
ln -s ~/Sites/ekolite/node_modules /tmp/ekolite-pr39-verify/node_modules
cd /tmp/ekolite-pr39-verify
npx vitest run --coverage
```

Four lines. Our main checkout never moved. The editor still showed main. Vitest ran against the other branch on a parallel copy that shared the same installed packages.

The third line is the small one. `node_modules` is not tracked by git, so a fresh worktree starts with none. Running `npm install` again would have worked but taken a minute and bought us nothing. The symlink lets both folders read the same installed packages. Quietly important.

When the work was done:

```
git worktree remove /tmp/ekolite-pr39-verify
```

The pointer went away. The main checkout was untouched. The branch itself lives on in our git history, ready to be opened in a new worktree, or checked out normally, or merged. Removing the worktree removed only the workspace.

## What is happening underneath

Two facts about the worktree are worth holding.

**The git database lives in your main checkout.** The second worktree's `.git` is not a directory but a single text file pointing back to the original. So `git log` from the second folder shows the same history as `git log` from the first. They are not two repos. They are one.

**Git refuses to let you check out the same branch in two worktrees at once.** Try and it will say so. The reason is straightforward: two folders writing commits to the same ref would leave nobody knowing which one to trust. The rule keeps each branch owned by exactly one working copy at any moment.

This second rule is the one worth pausing on. The tool will not let you do the thing that breaks the model. Worktrees are not "multiple parallel git repos". They are "one repo, multiple branches loaded for editing, each one owned by exactly one folder while it is open".

**Question for the pair:** what would it mean for a branch to live in two folders at once? Whose commit wins? The constraint is not arbitrary. Sit with the why.

## When to reach for it

Three patterns earn the keystrokes.

**Verification.** Someone's branch needs reading. You want the suite, you want the coverage, you want to poke at the diff with both branches open in the editor side by side. Worktree, run, remove. Your own work was never interrupted.

**Long running work.** A test suite or a build that takes minutes. Kick it off in a worktree, keep editing in your main checkout. No more "I cannot touch anything until this finishes."

**Side by side reads.** Comparing two versions of the same file with both open at once, both real on disk. Useful for refactors where the diff alone does not tell you what changed.

## When not to bother

Quick read of a single file on another branch: `git show the-branch:path/to/file.ts` is enough. The file content goes to stdout, no checkout needed. Save the worktree for when you need to _run_ the branch, not just read it.

Switching to a branch you will work on for the next hour: just `git checkout`. The worktree is for parallelism, not for replacing your normal flow.

## What we carry forward

**A worktree lets you be present to two branches at once.** Yours and theirs, side by side, no swap. The tool removes the false choice between engaging with someone else's work and protecting your own.

**The mechanics are small but specific.** `git worktree add <path> <branch>`, symlink `node_modules` if the branches share dependencies, `git worktree remove <path>` when done. The whole loop is four lines and you never lose your seat.

**The refusal to check out the same branch twice is the design speaking.** The tool will not let you create a state it cannot reason about. The same way a rebase makes you confront each conflict in context, a worktree makes you decide which branch each folder belongs to. Both are git refusing to make a decision that should be yours.

To verify a teammate's work is to be taught by it. The worktree creates the physical condition for that exchange. You read their branch, run their tests, sit with what they have made. Your own work is still on the desk where you left it, waiting for you to come back.
