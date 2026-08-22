# stagecraft

Plain actors on [Rivet](https://rivet.dev), with the production run smoothly.

**stagecraft** is an ergonomic layer over [`@rivetkit/effect`](https://www.npmjs.com/package/@rivetkit/effect): you write actors as plain async handlers and get durable state, one-message-at-a-time semantics, typed errors, scheduling, and events — without learning the underlying Effect machinery first. It also ships the crew that keeps a show running: an unexpected-error channel with agent-patchable reports, Sentry-style issue grouping with regression alerts, pluggable sinks (stdout, Discord), and a live monitor panel.

> **Status: exploratory v0.** This is an independent design exploration, not an official Rivet project. Every exported name is a placeholder. The `@rivetkit/effect` dependency is pinned; upstream changes are pulled in deliberately.

## The pitch, in code

```ts
import { actor } from "@authorofthesurf/stagecraft";

export const Counter = actor("Counter", {
  state: { count: 0 },
  handle: {
    Increment: async ({ by }: { by: number }, { state }) => {
      state.count += by;          // durable: committed when the handler succeeds
      return { count: state.count };
    },
  },
});
```

That's a durable, addressable, one-message-at-a-time actor. No `Effect.gen`, no `Layer`, no `yield*` — Effect is the implementation substrate underneath, not your problem. The flagship comparison: Rivet's launch-post chat room is 551 lines across 8 files in the raw Effect idiom; the same app on this layer is ~90 lines in one file ([`src/chat.ts`](src/chat.ts)) with zero Effect syntax in user code. Same engine, same wire format, same durability.

## The disclosure ladder

- **Level 0** — what you see above: plain async handlers, payload types on the signature, `throw fail.X()`, mutable state draft committed only on success, typed `emit` / `self.after(ms)` / `actors()`.
- **Level 1** — opt into declared schemas for wire validation and a standalone client contract.
- **Level 2** — declare resources/services (Effect's dependency channel), typed in the handler context, swappable in tests. Still no Effect syntax.
- **Level 3** — drop down to raw `Effect` / `@rivetkit/effect`. Every level is real Effect underneath, so climbing never means rewriting.

## Observability: the crew

A thrown error nobody declared doesn't vanish into a masked `internal_error`. It becomes:

1. a **typed `UnexpectedError`** to the caller (with a report id),
2. a **report** — actor, action, payload, committed state snapshot, stack — rich enough that a coding agent can read it and produce the patch,
3. an **issue**: reports group by fingerprint, Sentry-style. New issues alert; recurrences count quietly; a *resolved* issue that returns alerts loudly as a **REGRESSION** and reopens.

```ts
import { issueTracker, alertWith, stdoutAlert, discordAlert, startPanel } from "@authorofthesurf/stagecraft";

const tracker = issueTracker();
alertWith(tracker, stdoutAlert(), discordAlert({ webhookUrl }));
startPanel({ tracker });   // live web panel: actors, issues, failure feed
```

The panel also carries a per-actor **QUIET** watchdog flag — the other failure class. Wedged, slow, or unreachable actors throw nothing; only the *absence* of activity reveals them.

## Run the demo

```sh
bun install
bun run demo          # boots a real engine, opens http://localhost:4949
```

A referee actor scores rock-paper-scissors rounds and carries a realistic bug: the developer handled both winners and forgot that `winnerOf` can return `"draw"`. Watch the issue appear, click **Resolve**, and wait a few rounds for the 🔥 regression. `DISCORD_WEBHOOK_URL=…` adds Discord alerts; `DEMO_TICK_MS=8000` slows the pace.

```sh
bun test              # the full suite, against a real local engine
```

## The files

| File | What it is |
|---|---|
| [`src/layer.ts`](src/layer.ts) | The layer itself: `actor()`, `testEngine()`, the unexpected-error and activity channels |
| [`src/chat.ts`](src/chat.ts) | The chat-room exhibit — the launch-post app at level 0 |
| [`src/monitor-demo.ts`](src/monitor-demo.ts) | The Referee with the forgotten-draw bug |
| [`src/issues.ts`](src/issues.ts) | Fingerprint grouping + the new/recurrence/regression policy |
| [`src/adapters.ts`](src/adapters.ts) | Composable sinks: per-report `watch(...)` and issue-level `alertWith(...)` |
| [`src/panel.ts`](src/panel.ts) | The live panel: actors + QUIET watchdog, issues + Resolve, failure feed (SSE, zero deps) |
| [`src/demo-panel.ts`](src/demo-panel.ts) | The runnable demo |
| [`src/engine-hygiene.ts`](src/engine-hygiene.ts) | Reaps orphaned `rivet-engine` processes that would poison the next run |
| [`docs/posts/`](docs/posts/) | The story, told as posts: the intro and "The Forgotten Draw" |
| [`docs/design-notes.md`](docs/design-notes.md) | Design requirements, the ladder, and known v0 hazards |

## Design commitments

- **State is the durable store.** Every actor persists a JSON state document across sleep/restart; relational storage is an opt-in graft, not the default story.
- **Serialization is the actor model.** The layer runs one handler at a time per instance, because one-message-at-a-time is the promise. (Corollary: a handler that calls its own actor deadlocks — documented, not hidden.)
- **Errors are part of the contract.** Declared errors cross the wire typed and are guarded client-side; undeclared errors go to the unexpected-error channel instead of being masked.
- **Never hide the substrate.** Everything is real Effect underneath; the drop-down is graceful and encouraged when you need it.

## License

MIT
