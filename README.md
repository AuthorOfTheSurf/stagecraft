# stagecraft

[![CI](https://github.com/AuthorOfTheSurf/stagecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/AuthorOfTheSurf/stagecraft/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@authorofthesurf/stagecraft)](https://www.npmjs.com/package/@authorofthesurf/stagecraft)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> The developer-first actor framework & observability suite for [Rivet](https://rivet.dev).

**stagecraft** is an ergonomic layer over [`@rivetkit/effect`](https://www.npmjs.com/package/@rivetkit/effect): you write actors as plain async handlers and get durable state, one-message-at-a-time FIFO semantics, typed errors, durable scheduling, and events — without having to learn the underlying [Effect](https://effect.website/docs/getting-started/the-effect-type/) machinery first.

It also ships the **crew** that keeps a show running: an unexpected-error channel with agent-patchable reports, Sentry-style issue grouping with regression alerts, pluggable sinks (stdout, Discord, Slack), and a zero-dependency live monitor panel.

> **Status: experimental v0.x.** Stagecraft is an independent project, not an official Rivet project. The API is still evolving, so expect breaking changes. The `@rivetkit/effect` dependency is pinned; upstream changes are pulled in deliberately.

---

## A real actor, in plain TypeScript

This is the chat room from Rivet's Effect SDK launch post, rewritten in stagecraft. It is small enough to read in one sitting, but real enough to show the pieces that matter: durable state, typed domain errors, events, delayed messages, and actor-to-actor calls.

```ts
import { actor } from "@authorofthesurf/stagecraft";

type Member = { name: string; joinedAt: number };
type ChatMessage = { sender: string; text: string; at: number };

const Moderator = actor("Moderator", {
  state: {},
  errors: { BannedWords: {} as { reason: string } },
  handle: {
    Review: async ({ text }: { text: string }, { fail }) => {
      if (text.includes("spam")) {
        throw fail.BannedWords({ reason: "no spam allowed" });
      }
    },
  },
});

export const ChatRoom = actor("ChatRoom", {
  state: {
    name: "",
    members: [] as Member[],
    messages: [] as ChatMessage[],
  },
  events: {
    memberJoined: {} as { member: Member },
    memberLeft: {} as { name: string },
    newMessage: {} as ChatMessage,
  },
  errors: {
    MemberNotInRoom: {} as { member: string },
  },
  handle: {
    Initialize: async ({ name }: { name: string }, { state }) => {
      if (!state.name) state.name = name;
    },

    Join: async ({ name }: { name: string }, { state, emit, schedule }) => {
      const member = { name, joinedAt: Date.now() };
      state.members.push(member);
      emit.memberJoined({ member });
      schedule.after(250).SendMessage({
        sender: "Admin",
        text: `Welcome, ${name}!`,
      });
      return { memberCount: state.members.length };
    },

    Leave: async ({ name }: { name: string }, { state, emit, fail }) => {
      if (!state.members.some((m) => m.name === name)) {
        throw fail.MemberNotInRoom({ member: name });
      }
      state.members = state.members.filter((m) => m.name !== name);
      emit.memberLeft({ name });
    },

    SendMessage: async (
      message: { sender: string; text: string },
      { state, actors, emit, fail },
    ) => {
      const isAdmin = message.sender === "Admin";
      if (!isAdmin && !state.members.some((m) => m.name === message.sender)) {
        throw fail.MemberNotInRoom({ member: message.sender });
      }
      await actors(Moderator).getOrCreate("main").Review({ text: message.text });
      const chatMessage = { ...message, at: Date.now() };
      state.messages.push(chatMessage);
      emit.newMessage(chatMessage);
    },

    GetHistory: async (_: void, { state }) => state.messages,
  },
});
```

The shape is the point: define an actor, give it durable state, and describe its handlers in ordinary async TypeScript. Messages to one actor instance run one at a time. State changes commit only when a handler succeeds. Effect is still underneath, but it is the implementation substrate, not a second language you have to carry in your head.

Rivet's original launch-post chat room is 551 lines across 8 files in the raw Effect idiom. The same application is about 90 lines in one file ([`examples/chat.ts`](examples/chat.ts)) with zero Effect syntax in user code. Same engine, same wire format, same durability.

More exhibits live in [`examples/`](examples/): a durable AI agent session with human-in-the-loop approval, a realtime batch importer with a crash-safe cursor, and a per-subscriber drip campaign on durable timers — each backed by integration tests against a real engine.

---

## Comprehensive Feature Matrix

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                                STAGECRAFT                                   │
│  The developer-first actor framework & observability suite for Rivet       │
└─────────────────────────────────────────────────────────────────────────────┘
          │                                                  │
          ▼                                                  ▼
┌───────────────────────────────┐          ┌──────────────────────────────────┐
│   ON-STAGE: Actor Primitives  │          │   BACKSTAGE: Observability Crew  │
│   • Plain async handlers      │          │   • Agent-patchable error reports│
│   • Per-instance FIFO queues  │          │   • Sentry-style issue grouping  │
│   • Atomic state rollback     │          │   • Discord & Slack Block Kit    │
│   • Typed cross-actor errors  │          │   • SSE panel + QUIET watchdog   │
│   • Durable schedule.after()  │          │   • Fail-fast two-key security   │
│   • Client emit & routing     │          │   • Webhook connectivity tester  │
└───────────────────────────────┘          └──────────────────────────────────┘
```

### 1. The Actor Primitive ("On Stage")

| Feature | What it does | How it works under the hood |
|---|---|---|
| **Plain Async Handlers** | Write standard async functions without functional boilerplate | Wrapped in an Effect fiber runtime automatically |
| **Atomic State Drafts** | Modify `state.count += 1` directly; commits only on success | State is cloned before execution; committed via `state.update()` on resolution or discarded on throw |
| **Per-Instance FIFO Serialization** | Eliminates race conditions and lost updates without locks | Handlers queue on a per-instance `serialize` promise chain; distinct actors run concurrently |
| **Typed Error Channels** | Declare domain errors with payload schemas; throw with `fail.X()` | Mapped to `Schema.TaggedErrorClass` dynamically; propagates typed across actor boundaries |
| **Durable Timers (`schedule.after`)** | Schedule delayed messages: `const timerId = await schedule.after(ms).Action(payload)` | Backed by Rivet engine's durable scheduler (`schedule.after`), surviving reboots; hands back the scheduler's timer id |
| **Timer Cancellation (`schedule.cancel`)** | Revoke a scheduled timer: `await schedule.cancel(timerId)` | Delegates to `schedule.cancel`; `false` means already fired or unknown. Keep a state guard in the handler as the backstop for a fire already in flight |
| **Realtime Client Broadcast (`emit`)** | Broadcast events to connected clients: `emit.memberJoined(...)` | Routed through `rawRivetkitContext.broadcast()` |
| **Direct Actor-to-Actor Routing (`actors`)** | Call other actors with full autocomplete: `actors(Mod).getOrCreate(k).Review(p)` | Uses action-level Effect context to create and invoke typed client proxies |
| **Explicit Teardown (`destroy`)** | Cleanly terminate an actor instance when work is done | Invokes `rawRivetkitContext.destroy()` |

---

### 2. The Observability & Resilience Crew ("Backstage")

| Feature | What it does | Why it matters |
|---|---|---|
| **Agent-Patchable Error Reports** | Captures `reportId`, actor, action, payload, committed state snapshot, error, and stack trace | Provides the exact payload and state an AI coding agent or human needs to write a regression test and fix |
| **Sentry-Style Issue Grouping** | Groups reports by normalized fingerprint (`Referee.Play:TypeError:undefined…`) | Strips numbers and IDs from messages so a single defect never fragments into dozens of alert groups |
| **Smart 3-Stage Alert Policy** | • **NEW**: Alerts immediately<br>• **RECURRENCE**: Increments count silently<br>• **REGRESSION**: Alerts loudly if a resolved issue recurs | Eliminates alert fatigue while ensuring regressions are treated as high-priority incidents |
| **Composable Alert Sinks** | Pluggable sinks: `stdoutAlert`, `discordAlert` (embeds), and `slackAlert` (Block Kit) | Easily sends structured alerts into engineering chat channels with rich formatted metadata |
| **Fail-Fast Webhook Wiring** | Validates URL structure and scheme at startup; redacts values in errors | Prevents secret leakage in error logs and stops the process from running with a dead alert channel |
| **Webhook Connectivity Tester (`hello.ts`)** | `bun run hello --slack [--example-error]` | Allows verifying webhook plumbing and reviewing real payload styling before booting the full application |

---

### 3. The Live Monitor Panel (`startPanel`)

> Imported from `@authorofthesurf/stagecraft/panel`. It runs on `Bun.serve`, so it lives behind its own subpath and never enters a build that cannot run it.

| Component | Capabilities |
|---|---|
| **Zero-Dependency SSE Server** | Serves a single-page dark-themed dashboard over native `Bun.serve` and Server-Sent Events (`/events`). No React, Tailwind, or npm client dependencies. |
| **Actors Table with `QUIET` Watchdog** | Shows real-time activity (last action, outcome, latency in ms). Flags actors as **`● QUIET`** if they stop emitting events past a threshold, surfacing wedged or dead actors. |
| **Interactive Issues Table** | Displays open/resolved/regression status, total recurrence counts with live amber flash animations, and an interactive **Resolve** button (`POST /resolve?fp=...`). |
| **Collapsible Failure Feed** | Groups repeated errors under `<details>` accordions with live incrementing counts, displaying the newest report payload, state, and stack. |
| **SSE Reconnect Resync** | Automatically clears stale DOM elements and resynchronizes from the server's in-memory backlog when an SSE connection reconnects. |

---

### 4. Developer & Testing Ergonomics

| Tool | Problem Solved |
|---|---|
| **One-Line Test Engine (`testEngine`)** | Boots a local `rivet-engine` instance with typed client accessors. Merges actor layers into a single `ManagedRuntime` to prevent `Registry.test` clobbering. |
| **Zombie Engine Reaper (`reapOrphanEngines`)** — from `@authorofthesurf/stagecraft/testing` | Automatically searches for and terminates orphaned `rivet-engine` background processes on startup, preventing port 6420 collisions. |
| **Two-Key Security Pattern** | External alerting requires both a deliberate CLI flag (`--slack`, `--discord`) and the environment variable (`SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`), catching typos early. |
| **Publish Quality Gate** | `prepublishOnly` script automatically runs `tsc --noEmit`, `bun test`, and `bun run build` before packaging to npm. |

---

## Start small, grow in place

Four levels; you meet the layer where you are, and each one is real Effect underneath — so climbing never means rewriting.

- **Level 0, your everyday code** — what you see above: plain async handlers, payload types on the signature, `throw fail.X()`, mutable state draft committed only on success, typed `emit` / `schedule.after(ms)` / `actors()`.
- **Level 1, the contract** — opt into declared schemas for wire validation and a standalone client contract.
- **Level 2, the wiring** — declare resources/services (Effect's dependency channel), typed in the handler context, swappable in tests. Still no Effect syntax.
- **Level 3, the engine room** — drop down to raw `Effect` / `@rivetkit/effect`, full power, a supported move.

The design bar the whole repo is measured against — seven named requirements, from "matches the actor mental model" to "IDE and agent legibility" — lives in [`docs/requirements.md`](docs/requirements.md). And credit where due: much of what makes this layer thin is that the substrate is good — [`docs/upstream-strengths.md`](docs/upstream-strengths.md) records what `@rivetkit/effect` does well, and the functionality floor stagecraft must never regress below.

---

## Observability: the crew in action

A thrown error nobody declared doesn't vanish into a masked `internal_error`. It becomes:

1. a **typed `UnexpectedError`** to the caller (with a report id),
2. an **agent-patchable report** — actor, action, payload, committed state snapshot, stack — rich enough that a coding agent can read it and produce the patch,
3. an **issue**: reports group by fingerprint, Sentry-style. New issues alert; recurrences count quietly; a *resolved* issue that returns alerts loudly as a **REGRESSION** and reopens.

```ts
import { issueTracker, alertWith, stdoutAlert, discordAlert, slackAlert } from "@authorofthesurf/stagecraft";
import { startPanel } from "@authorofthesurf/stagecraft/panel";

const tracker = issueTracker();
alertWith(tracker, stdoutAlert(), discordAlert({ webhookUrl }), slackAlert({ webhookUrl: slackUrl }));
startPanel({ tracker });   // live web panel: actors, issues, failure feed
```

---

## Run the demo

```sh
bun install
bun run demo          # boots a real engine, opens http://localhost:4949
```

A referee actor scores rock-paper-scissors rounds and carries a realistic bug: the developer handled both winners and forgot that `winnerOf` can return `"draw"`. Watch the issue appear, click **Resolve**, and wait a few rounds for the 🔥 regression. With no flags you get the panel and stdout alerts — a basic error monitor with zero external dependencies.

External alerting is two-key — a flag for intent, an env var for the credential, both required:

```sh
bun run demo --discord    # requires DISCORD_WEBHOOK_URL (setup guide: docs/qa/discord-adapter.md)
bun run demo --slack      # requires SLACK_WEBHOOK_URL (setup guide: docs/qa/slack-adapter.md)
```

A flag whose env var is missing or garbled kills the demo at boot rather than running with a silently dead channel. `DEMO_TICK_MS=8000` slows the pace.

To verify a channel is wired without running the demo at all:

```sh
bun run hello --slack               # posts "hello, world!" to the channel
bun run hello --discord             # posts "hello, world!" to discord
bun run hello --slack --example-error   # posts a realistically-shaped (clearly fake) error report
```

```sh
bun test              # the full suite, against a real local engine
```

---

## Repository Map

**The package** — this is all that ships to npm.

| File | What it is |
|---|---|
| [`src/layer.ts`](src/layer.ts) | The layer itself: `actor()`, `testEngine()`, the unexpected-error and activity channels |
| [`src/issues.ts`](src/issues.ts) | Fingerprint grouping + the new/recurrence/regression policy |
| [`src/adapters.ts`](src/adapters.ts) | Composable sinks: per-report `watch(...)` and issue-level `alertWith(...)` — stdout, Discord, Slack |
| [`src/tools/panel.ts`](src/tools/panel.ts) | `stagecraft/panel` — the live panel: actors + QUIET watchdog, issues + Resolve, failure feed (SSE, zero deps) |
| [`src/tools/testing.ts`](src/tools/testing.ts) | `stagecraft/testing` — reaps orphaned `rivet-engine` processes that would poison the next run |
| [`src/tools/hello.ts`](src/tools/hello.ts) | The `stagecraft` bin: webhook connectivity check — `npx @authorofthesurf/stagecraft hello --slack` |
| [`src/index.ts`](src/index.ts) | The root export: the portable core. Backstage tools sit behind their own subpaths, so importing `actor` never drags a Bun-only web server into your build. |

**The exhibits** — examples and tests, repo-only.

| File | What it is |
|---|---|
| [`examples/chat.ts`](examples/chat.ts) | The chat-room exhibit — the launch-post app at level 0 |
| [`examples/support-agent.ts`](examples/support-agent.ts) | A durable AI agent session with human-in-the-loop approval |
| [`examples/csv-importer.ts`](examples/csv-importer.ts) | A realtime batch importer: durable cursor, live progress events |
| [`examples/drip-campaign.ts`](examples/drip-campaign.ts) | A per-subscriber drip sequence on durable timers |
| [`examples/monitor-demo.ts`](examples/monitor-demo.ts) | The Referee with the forgotten-draw bug |
| [`examples/demo-panel.ts`](examples/demo-panel.ts) | The runnable demo: `bun run demo` |
| [`test/`](test/) | Integration tests, borrowing the examples as fixtures |

**The docs.**

| File | What it is |
|---|---|
| [`AGENTS.md`](AGENTS.md) | AI coding agent reference: rules of the stage, error contracts, and self-deadlock prevention |
| [`docs/qa/`](docs/qa/) | From-zero setup and manual QA runbooks for Discord and Slack webhook adapters |
| [`docs/posts/`](docs/posts/) | The story, told as posts: the intro and "The Forgotten Draw" |
| [`docs/design-notes.md`](docs/design-notes.md) | Design requirements, the ladder, and known v0 hazards |
| [`docs/upstream-strengths.md`](docs/upstream-strengths.md) | What `@rivetkit/effect` gets right, and the functionality floor |

---

## Design commitments

- **State is the durable store.** Every actor persists a JSON state document across sleep/restart; relational storage is an opt-in graft, not the default story.
- **Serialization is the actor model.** The layer runs one handler at a time per instance, because one-message-at-a-time is the promise. (Corollary: a handler that calls its own actor deadlocks — documented, not hidden.)
- **Errors are part of the contract.** Declared errors cross the wire typed and are guarded client-side; undeclared errors go to the unexpected-error channel instead of being masked.
- **Never hide the substrate.** Everything is real Effect underneath; the drop-down is graceful and encouraged when you need it.

## License

MIT

