# AI Coding Agent Guide for stagecraft

> A concise, zero-shot reference for AI coding agents (and humans) writing actors, tests, and integrations with `stagecraft`.

---

## 1. Core Architecture in 30 Seconds

- **What is stagecraft?** An ergonomic, developer-first layer over `@rivetkit/effect`.
- **Syntax**: Write plain `async` functions. **Do not use `Effect.gen`, `yield*`, `Layer`, or `Pipe` in actor handler code.**
- **Concurrency**: Messages to the *same* actor instance execute sequentially in **per-instance FIFO order**. Messages to *distinct* actor instances run concurrently.
- **State**: `state` inside a handler is a mutable draft. Changes commit when the function returns successfully; thrown errors discard the draft automatically (atomic rollback).

---

## 2. Canonical Actor Template

```ts
import { actor } from "@authorofthesurf/stagecraft";
import { Schema as S } from "effect";

export const GameRoom = actor("GameRoom", {
  // 1. Initial durable state
  state: {
    players: [] as string[],
    isLocked: false,
  },

  // 2. Declared domain errors (expected business rejections)
  errors: {
    RoomFull: { max: S.Number },
    RoomLocked: {},
  },

  // 3. Broadcast events to connected clients
  events: {
    PlayerJoined: S.Struct({ player: S.String }),
  },

  // 4. Action handlers (plain async functions)
  handle: {
    Join: async ({ player }: { player: string }, { state, fail, emit, schedule, actors }) => {
      if (state.isLocked) {
        throw fail.RoomLocked({}); // ✅ Declared error
      }
      if (state.players.length >= 4) {
        throw fail.RoomFull({ max: 4 }); // ✅ Declared error
      }

      // Direct state mutation on draft
      state.players.push(player);

      // Real-time broadcast
      emit.PlayerJoined({ player });

      // Schedule follow-up work on this actor in 5 seconds
      schedule.after(5000).AutoStart({});

      return { joined: true, count: state.players.length };
    },

    AutoStart: async (_payload: {}, { state }) => {
      if (state.players.length >= 2) {
        state.isLocked = true;
      }
    },
  },
});
```

---

## 3. The Error Rules (Crucial)

Stagecraft strictly separates **domain rejections** from **unexpected crashes**:

| Error Type | Syntax | What happens |
|---|---|---|
| **Declared Domain Error** | `throw fail.MyError({ ... })` | Crosses the wire typed to the caller (`GameRoom.is.RoomFull(err)`). State rolls back. **Does NOT alert Slack/Discord.** |
| **Unexpected Bug / Crash** | `throw new Error("...")` or runtime exceptions (`TypeError`, etc.) | Creates an incident report (`reportId`, payload, state, stack). Discards state draft. **Alerts Slack/Discord/stdout.** |

### ❌ Anti-Pattern to Avoid:
```ts
// ❌ WRONG: Do not throw generic Error instances for business logic!
class RoomFullError extends Error {}
throw new RoomFullError("Room is full"); // Treated as an operational incident / bug!
```

### ✅ Correct Pattern:
```ts
// ✅ RIGHT: Declare in errors map, throw via fail.X()
errors: { RoomFull: { max: S.Number } },
// ...
throw fail.RoomFull({ max: 4 });
```

---

## 4. Actor-to-Actor Calls & The Self-Deadlock Rule

### Calling Another Actor (Safe):
```ts
// Calling another actor instance or another actor type:
const moderator = actors(Moderator).getOrCreate("global");
const result = await moderator.ReviewText({ text: "hello" });
```

### ⚠️ The Self-Deadlock Hazard:
Because an actor instance executes messages one at a time (FIFO), **never await your own actor instance synchronously**:

```ts
// ❌ DEADLOCK: An actor calling itself synchronously hangs forever!
handle: {
  ActionA: async (_, { actors }) => {
    // Hangs forever: ActionA is waiting for ActionB, but ActionB is queued behind ActionA!
    await actors(MyActor).getOrCreate("my-own-key").ActionB({});
  }
}
```

### Cancelling a Scheduled Timer:
`schedule.after(...).Action(p)` returns a **durable timer id** (`Promise<string>`) — ignore it for fire-and-forget, or keep it in state to revoke the timer later:

```ts
// Arm: keep the id in durable state
state.pending = { id, timerId: await schedule.after(ttlMs).Expire({ id }) };

// Resolve: cancel the timer (false = already fired or unknown — harmless)
await schedule.cancel(state.pending.timerId);
```

Cancellation is best-effort: a fire already in flight can still land, so the scheduled handler should **re-check state and no-op when stale** (see `examples/support-agent.ts` and `examples/drip-campaign.ts`). Also note: scheduling is a side effect that does NOT roll back if the handler later throws — cancel is the compensation tool.

### Internal (Scheduled-Only) Handlers:
A handler in `handle` is a **public wire action** — any client can call it. A step that only a timer should drive (a drip send, an expiry sweep, a work loop) belongs in the actor's `internal` block instead:

```ts
export const DripCampaign = actor("DripCampaign", {
  state: { /* … */ },
  handle: {
    Subscribe: async (p, { state, schedule }) => {
      await schedule.after(p.steps[0].afterMs).SendStep({ index: 0 }); // fine: internal names are schedulable
    },
  },
  internal: {
    SendStep: async ({ index }, ctx) => { /* only a timer can reach this */ },
  },
});
```

Internal handlers never become wire actions — a client cannot even address them. Scheduling one routes through a guarded dispatcher carrying a proof from the actor's durable kv, which no client can read; a forged call is rejected with the typed `InternalOnly` error (`isInternalOnly(e)`). Still keep the state re-check inside the handler — it remains the backstop for a stale fire (see the cancellation section above).

Two names the framework owns, so `errors` cannot declare them: **`InternalOnly`** and **`UnexpectedError`**. Both are raised by stagecraft itself and tested for by `isInternalOnly` / `isUnexpected`, so a domain error reusing either name would be misreported as a framework rejection. Declaring one throws at definition time.

A forged dispatcher call also carries an arbitrary `tag`. It is used as the reported action name only once it is known to match a declared internal handler; anything else reports as `__scheduled`, so wire text never reaches the activity feed, the reports, or the panel.

### How to Chain Work on Yourself:
1. **Same transaction (synchronous)**: Call a plain JavaScript/TypeScript helper function directly:
   ```ts
   const internalUpdate = (state: State) => { state.count += 1; };
   // inside handler:
   internalUpdate(state);
   ```
2. **Next transaction (asynchronous)**: Schedule it via `schedule.after(0)`:
   ```ts
   schedule.after(0).ActionB({}); // Enqueued for the next turn; current handler finishes and commits.
   ```

---

## 5. Testing Actors with `testEngine`

Stagecraft provides a one-line real local engine fixture for `bun test`:

```ts
import { expect, test } from "bun test";
import { testEngine } from "@authorofthesurf/stagecraft";
import { GameRoom } from "./game-room";

test("join and error handling", async () => {
  // 1. Boot test engine with actor definitions
  const engine = await testEngine(GameRoom);

  // 2. Create typed client with a unique key
  const room = engine.client(GameRoom).getOrCreate("test-room-1");

  // 3. Invoke actions like standard async methods
  const res = await room.Join({ player: "Alice" });
  expect(res.joined).toBe(true);
  expect(res.count).toBe(1);

  // 4. Test declared errors
  try {
    await room.Join({ player: "Bob" });
  } catch (err) {
    if (GameRoom.is.RoomLocked(err)) {
      // Typed error guard
    }
  }
});
```

---

## 6. Observability & Sinks

```ts
import { issueTracker, alertWith, stdoutAlert, discordAlert, slackAlert } from "@authorofthesurf/stagecraft";
import { startPanel } from "@authorofthesurf/stagecraft/panel";

const tracker = issueTracker();

// Pluggable alert sinks
alertWith(
  tracker,
  stdoutAlert(),
  discordAlert({ webhookUrl: process.env.DISCORD_WEBHOOK_URL! }),
  slackAlert({ webhookUrl: process.env.SLACK_WEBHOOK_URL! })
);

// Zero-dependency SSE Live Web Panel
startPanel({ tracker, port: 4949 });
```
