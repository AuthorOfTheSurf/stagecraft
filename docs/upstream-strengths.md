# What `@rivetkit/effect` does well

stagecraft exists because the raw idiom asks too much of a newcomer — but the comparison is only honest if the credit side of the ledger is written down too. Upstream gets real things right, and several of them are load-bearing *inside* stagecraft: the layer is thin precisely because the substrate is good. This page is that credit, and doubles as a functionality floor — **anything listed in the second half is a regression if stagecraft ever loses it.**

## The credit side

Observed while building the layer and its exhibits against `@rivetkit/effect` 2.3.10 (all first-hand, not marketing claims):

- **Schema-to-client type inference is excellent.** Our first real workload experiment typechecked on the first pass. The wire contract you declare is the client type you get — nothing hand-maintained in between. Requirement R7 (IDE and agent legibility) is largely *inherited* from this.
- **The testing story delivers.** `Registry.test` auto-spawns a real engine for a `bun test` suite — outside their own vitest harness — without a fight. Dependency injection through Layer means a test can swap a real service for a mock with a one-line substitution. stagecraft's `testEngine()` is a thin wrapper over this; the seam is upstream's.
- **Typed errors cross the wire clean.** A tagged error thrown in a handler arrives at the caller catch-able by tag with its fields intact, in a proper error envelope. The engine's own logs show the tagged payload. stagecraft's declared-error story is sugar over a wire format that already existed and already worked.
- **The contract/implementation split earns its file.** The `api.ts` pattern imports safely into client code with zero server leakage — the discipline stagecraft's level 1 ("the contract") formalizes was upstream's idea first.
- **Reject-before-mutate discipline in every example.** Their example code consistently validates before touching state, which is why stagecraft's draft-commit semantics compose with the substrate instead of fighting it.
- **Wake-scope design is genuinely thoughtful.** Services are yielded once per wake, not per action; `state.changes` is a subscribable stream; finalizers run on sleep; actor-to-actor RPC goes through the same client API; embedded SQLite ships with an `onMigrate` hook.
- **Actor-to-actor calls, scheduling, and events are all present** in the raw context — stagecraft's `actors()`, `schedule.after(ms)`, and `emit` are typed handles on machinery that upstream already runs.

The honest summary: **upstream's engine and wire layers are strong; the friction is concentrated in the developer-facing surface** (ceremony, packaging, options plumbing). That is exactly why a thin layer can fix so much — and why this project is a complement, not a fork.

## The functionality floor

What stagecraft itself guarantees today, with provenance per the house rule (a claim is either **proven by a named test** or **implemented, awaiting an acceptance test** — never assumed). This is the no-regression list.

| Guarantee | Plain-language statement | Provenance |
|---|---|---|
| **Atomic state drafts** | A handler mutates a draft; state commits only if the handler succeeds. A failed handler leaves state untouched. | Proven: `chat.test.ts` — "a failed handler leaves state untouched (draft discarded)" |
| **Typed declared errors** | Errors declared on an actor cross the wire typed; callers catch them by name with fields intact. | Proven: `chat.test.ts` — "typed errors: non-members bounce, moderator error flows to the caller" |
| **Unexpected-error channel** | An undeclared throw becomes a typed `UnexpectedError` to the caller plus a rich report (actor, action, payload, state, stack) — and the actor survives. | Proven: `monitor.test.ts` — "the forgotten draw: typed error, rich report, actor survives" |
| **Scheduling** | `schedule.after(ms)` delivers a future message to the same instance. | Proven: `chat.test.ts` — "join, chat, and the scheduled Admin welcome lands" |
| **Issue grouping policy** | Reports group by fingerprint; new alerts, recurrence counts quietly, resolved-then-recurs alerts loudly as a regression. | Proven: `issues.test.ts` (all three tests) |
| **Sink isolation** | A broken alert sink never masks a report from the other sinks, and never crashes the process. | Proven: `adapters.test.ts` — "dispatch fans one report out…" |
| **Fail at wiring, not at incident time** | A missing or garbled webhook URL throws at adapter construction, with the value never echoed. | Proven: `adapters.test.ts` — "webhook adapters fail fast at construction…" |
| **Per-instance FIFO** | One handler runs at a time per actor instance; a concurrent burst serializes with zero lost updates. | **Implemented, awaiting an acceptance test in this repo.** Proven once against the raw idiom in the proving-ground experiment (20-message burst, ledger balanced), not yet re-proven through stagecraft's own surface. |
| **Ask-as-barrier** | Awaiting any ask means the mailbox is drained up to it. | **Observed in the proving-ground experiment; not yet a stated, tested guarantee here.** Should be documented as a guarantee, not left as an accident. |

## Toward plain-language acceptance tests

The floor above is written in plain language on purpose. The eventual shape (tracked as a ticket) is Cucumber-style acceptance specs: each guarantee stated so anyone — including a non-engineer, including a coding agent — can read what the system does and doesn't do, with each statement backed by an executable test. For a post-MVP substrate that still carries hidden bugs, "what do we actually guarantee?" needs an answer that isn't folklore. The two **awaiting** rows in the table are the first candidates.

## Links

- [`requirements.md`](requirements.md) — the design bar (R1–R7, the four levels)
- [`design-notes.md`](design-notes.md) — the full design doc, including known v0 hazards
