# The proposed simple SDK

A working v0 of the ergonomic layer we believe should sit on top of `@rivetkit/effect`. Deliberately **not** named "effect" — this is a layer (or two) above it: Effect is the implementation substrate, not the user's problem. Every exported name here is a **placeholder**; Rivet names things.

## Why this exists

Rivet's actor primitive is excellent. Its current Effect SDK asks a newcomer to learn ~18 Effect concepts (`Effect.gen`, `yield*`, `Layer`, `Scope`, `fnUntraced`, …) before the first actor runs — the flagship chat-room example is 551 lines across 8 files. The same app on this layer is ~90 lines in 1 file with **zero Effect syntax in user code** ([`chat.ts`](../examples/chat.ts)). Same engine, same wire format, same durability underneath.

The design requirements, in one breath: match the actor mental model (messages, handlers, state, visible by name); require no prerequisite ecosystem; pass the Stripe test (basic integration in 10–20 lines, ~20 minutes); be built *on* Effect, not hiding from it (graceful drop-down); and let a vague mental model start small and harden incrementally.

## The four levels

- **Level 0** (what you see in `chat.ts`): plain async handlers, payload types on the signature, `throw fail.X()`, mutable state draft committed only on success, typed `emit` / `self.after(ms)` / `actors()`. One handler at a time per instance — the actor model's actual promise, delivered.
- **Level 1**: opt into declared schemas for wire validation and a standalone client contract.
- **Level 2**: declare resources/services (Effect's dependency channel) — typed in the handler context, swappable in tests. Still no Effect syntax.
- **Level 3**: drop down to raw `Effect` / `@rivetkit/effect`. Every level is real Effect underneath, so climbing never means rewriting.

## The files

| File | What it is |
|---|---|
| [`layer.ts`](../src/layer.ts) | The layer itself: `actor()`, `testEngine()`, and the unexpected-error channel |
| [`chat.ts`](../examples/chat.ts) | The launch-post chat room on the layer — the Part 1 exhibit |
| [`monitor-demo.ts`](../examples/monitor-demo.ts) | Part 2: the Referee with the forgotten-draw bug + the in-process monitor |
| [`adapters.ts`](../src/adapters.ts) | Composable report sinks: `watch(stdout(), discord({webhookUrl}))` |
| [`tools/panel.ts`](../src/tools/panel.ts) | The live web panel: actors table with QUIET watchdog + failure feed over SSE |
| [`demo-panel.ts`](../examples/demo-panel.ts) | Run it: boots an engine, opens the panel, plays RPS until the draw hits |
| [`test-harness.ts`](../test/test-harness.ts) | One engine + one registry per process (two `Registry.test` instances clobber each other) |
| [`posts/`](./posts/) | The story, told as posts: the rewritten intro and Part 2 |
| The raw-idiom baseline (the same patterns written directly against `@rivetkit/effect`) lives alongside the original exhibit; the side-by-side is told in [`posts/01-introducing.md`](./posts/01-introducing.md). ||

## Design concerns we're carrying

- **State is the durable store.** Every actor already persists a JSON state document across sleep/restart. SQLite is an opt-in graft for relational or large data (`db` handle appears only in handlers that want it), not the default persistence story.
- **Errors**: declared errors cross the wire typed and are guarded client-side (`Room.is.MemberNotInRoom(e)`); a `try` variant returning a union is the opt-in for exhaustive handling. Undeclared errors go to the **unexpected-error channel** — see Part 2.
- **Serialization**: the raw SDK runs an actor's actions concurrently; this layer serializes handlers per instance because one-message-at-a-time *is* the actor model. Corollary to document: a handler that calls its own actor deadlocks.
- **Known v0 hazards** (tracked in the design doc): error flattening onto `Error` collides with reserved props (`name`); the action-time Effect context — not the wake context — is what makes promise-land actor-to-actor calls work; `Client.layer()` must be provided into actor lives.

The full design doc (requirements, honesty map of ships-today vs. pending vs. proposal, build log) lives in the private wiki; a shareable RFC gets extracted from it later.
