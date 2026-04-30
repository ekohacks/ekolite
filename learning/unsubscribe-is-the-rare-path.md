# Unsubscribe Is the Rare Path

> "The teacher is no longer merely the-one-who-teaches, but one who is himself taught in dialogue with the students." Paulo Freire

A subscription is a relationship. A client says "tell me about files", the server says yes and starts pushing data, and at some point the relationship ends. The interesting question, the one we walked through on PR #31, is what "ends" actually means.

The story we wrote, EKO-229 / Story 3.A.4, called itself "Unsubscribe Stops Updates". The wording put the `unsubscribe` message at the centre. The PR delivered exactly that. Tests went red, then green, then refactored, all on the message path. Composite keys for client and sub id, cleanup functions stored and called, no extra messages after the unsubscribe. Clean work.

And it ships a leak.

## Where the leak lives

Open `server/logic/publications.ts` on the EKO-229 branch. Read `handleMessage` from the top. You'll see two paths through it. `subscribe` opens a watcher and stores its cleanup function in a per-client map. `unsubscribe` looks up that cleanup function and calls it. Two messages, two paths, both correct.

Now ask yourself a different question. In production, how does a subscription actually end?

Not "what message does the client send when it wants to unsubscribe", but "what really happens, on a real laptop, in a real browser, when a real user is using the app".

The answer is mostly: it doesn't send a message at all.

- The user closes the tab.
- The user navigates to a different page.
- The user puts their laptop to sleep and the socket times out.
- The wifi drops on a train.
- Chrome decides the tab has been backgrounded too long and freezes the JS thread.
- The user refreshes, deliberately or by accident.
- A React component unmounts because some upstream state changed and the cleanup function gets queued behind a navigation that never resolves.

In every one of those cases, the WebSocket closes. The server notices, eventually, when its keepalive fails or the OS reports the socket as dead. But no `unsubscribe` message is ever sent.

Which means the watcher we so carefully torn down on the message path is still alive. And the per-client map, the one keyed by client id with all its sub ids inside, still has an entry for a client that hasn't existed for an hour.

Run a busy session through that. Refresh ten times. Each refresh opens fresh subscriptions and abandons the previous ones in the server's memory. Multiply by every user, every session, every day. The leak is the dominant case.

## The story scoped itself out of its own goal

This is the moment that matters, so look at it carefully. The story file said:

> Don't add handling for `unsubscribe` yet. That's Story 3.A.4. Only handle `subscribe` for now.

And the 3.A.4 story file said:

> Handle `type: 'unsubscribe'` in `handleMessage()`.

And under definition of done:

> No memory leaks on repeated subscribe/unsubscribe.

Three sentences, all sensible in isolation. Together they describe a story that handles the rare path, calls it the whole job, and uses the words "no memory leaks" while leaving the dominant leak in place.

This isn't anyone's fault. The story file was honest about what it was scoped to. The PR delivered what the story asked for. The tests cover what they claim to cover. Every piece passes its own bar.

What it tells us is that scope is a stance, not a fact. A story that names itself "Unsubscribe Stops Updates" has decided the work is about the message. A story that named itself "Subscriptions Don't Leak" would have decided the work was about the lifecycle. Same code in front of you. Different scope. Different ship.

## What "subscription doesn't leak" actually requires

Walk the lifecycle. A subscription is born when the client sends `subscribe` and the server opens a watcher. From that moment until the watcher is torn down, the server is holding resources on the client's behalf. The server doesn't know how long the client wants those resources held. It only knows when the client tells it, and the client tells it through two channels.

The polite channel is a `unsubscribe` message. The impolite channel is the socket closing.

A complete teardown story handles both. The polite path lets the client stop one subscription while keeping the rest. The impolite path tears down everything the client owned, because the client itself is gone. Different triggers, same plumbing.

The plumbing is already there. The current PR keys subscriptions by client id. That data structure has one job: let you ask "what does this client own". On `unsubscribe` you ask it about one sub id. On disconnect you ask it about all of them. Same map, same cleanup functions, different traversal. A handful of lines and one test.

The reason it didn't land in this PR is the story didn't ask for it. The reason the story didn't ask for it is the story was named after the message instead of the goal.

## Who owns subscription state

There's a second decision in the same PR worth pulling apart, because it sits on the same fault line. What happens when a client subscribes twice with the same sub id?

The PR's answer: tear down the old watcher and start a fresh one. "Dispose the old one first."

There is a defensible alternative: refuse the duplicate, send an error, force the client to unsubscribe before it can resubscribe. Strict. Loud. Surfaces client bugs immediately.

Both stances are coherent. The decisive question is who owns subscription state.

Sub ids are chosen by the client. The server doesn't generate them, doesn't validate them, doesn't know what they mean. They are labels the client uses to track its own subscriptions on its own side. When a client sends `subscribe { id: 'sub1' }` for the second time, the only thing it can possibly mean is "this is what sub1 refers to now".

The strict server hears that and replies "no, you already told me what sub1 was". It's making a claim about what the client's state is, against the only entity that actually knows. It's politely wrong.

The tolerant server hears the same message and replies "right, that's what sub1 is now" and rebuilds. It is downstream of the client's reality. It absorbs whatever the client says, including things the client says by accident or as a retry or as a remount artefact.

The cost of tolerance is real. A client bug that reuses a sub id won't crash. It will produce subtle churn instead. The watcher gets torn down and rebuilt invisibly. You'll find it in load testing, or in logs, not at the protocol layer. That's a real cost, paid once per debug session, not once per request.

The cost of strictness is paid every time. Every retry-on-flake, every React strict-mode double-mount, every subscribe-after-reconnect needs explicit reconciliation in the client. The protocol becomes something you have to dance with, not something you can use.

Browsers are unpredictable. The client side of any real-time data layer needs the server to absorb its mess. The Meteor crowd worked this out twenty years ago and DDP is permissive for the same reason. EkoLite inherits the same shape because the same forces are at play.

## The through-line

Both decisions, the disconnect one and the duplicate-id one, point at the same thing.

The server is downstream of the client. Subscription state is owned by the client. The server's job is to follow the client's reality, not enforce a protocol against it.

That stance has consequences in code:

- On disconnect, you tear down everything that client owned, even though it didn't say goodbye, because the only authoritative answer about whether the client still wants its subscriptions is whether the client is still there.
- On duplicate sub id, you accept the new subscription as authoritative, because the only authoritative source of what `sub1` means is the client that named it.
- On reconnect (which we'll get to in a later story), you let the client re-establish subscriptions cleanly, because the client is the one who knows what it had open.

In every case the question is the same. Who knows? And in every case the answer is the same. The client. The server's job is to make that easy.

## What this means for how we name stories

The lesson worth pocketing isn't about subscriptions or DDP. It's about how stories get scoped.

A story named after a message handler will deliver a message handler. A story named after a goal will deliver the goal. The first costs less to write and more to live with. The second costs more to write and surfaces leaks before they ship.

When you draft the next story, look at the title. If it names a piece of the implementation, ask what would happen if you renamed it after the user-visible outcome. Sometimes the answer is the same code. Sometimes it's the difference between a clean watcher map and a slow leak.

We caught this one in review, which is what review is for. The cheaper place to catch it is in the title, before any code is written.

**Question for the pair.** Look at the next ticket in your backlog. Read the title. Is it named after the message, the function, the file, or the user-facing thing the user actually gets when this ships? If it's the first three, what would change if you rewrote the title as the fourth?
