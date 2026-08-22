# The bar: seven requirements

Everything in this repo is measured against these. They were written before the first line of the layer, and the dream code had to pass all of them before it earned an implementation.

| # | Requirement | The test |
|---|---|---|
| **R1** | **Matches the actor mental model.** | The words on screen are the developer's words: *messages*, *handlers*, *state*, *mailbox*. No mental translation table required to read the code. |
| **R2** | **No prerequisite ecosystem.** | A developer who has never seen Effect can ship a working actor. "Built on Effect — and if you're new to Effect, that's fine." |
| **R3** | **The Stripe test.** | Stripe handles *payments* and integration is still 10–20 lines in 20 minutes. A basic actor: same. Not a six-page blog post and 200 lines. |
| **R4** | **Built on Effect, not hiding from it.** | Thin sugar over `@rivetkit/effect`. Dropping down to full Effect is a supported move, not an escape hatch you're punished for. |
| **R5** | **Three things to know.** | The Effect concepts a user must absorb up front: **return types, error types, resources**. That's the whole entry exam — the `A`/`E`/`R` of `Effect<A, E, R>` without ever saying so. |
| **R6** | **Bite-sized development.** | A developer with a vague mental model can start with the equivalent of a bare GET endpoint and harden incrementally — types first, errors when they matter, resources when they appear. The framework never demands the whole flow up front. |
| **R7** | **IDE and agent legibility.** | Typing `barn.` surfaces everything you can say to the barn — sends, asks, reads — fully typed. No stringly dispatch, no `_tag` in user code, no API knowledge that lives outside the types. This serves coding agents exactly as it serves IDEs: both explore an API through its types. (Added from live review of the first exhibit.) |

The framework test behind all of them: **a good framework makes application code look simpler.** JavaScript REST frameworks converged on `GET`/`POST` functions that just return values, with a testable service layer beneath. That is the compression target.

## The four levels

You meet the layer where you are, and each level is real Effect underneath — so climbing never means rewriting.

| Level | Nickname | What it looks like |
|---|---|---|
| 0 | **Your everyday code** | Plain async handlers, payload types on the signature, `throw fail.X()`, mutable state draft committed on success. What almost all application code should be. |
| 1 | **The contract** | Opt into declared schemas per message: wire validation and a standalone client contract, without changing what level-0 code looks like. |
| 2 | **The wiring** | Declare resources and services (Effect's dependency channel), typed in the handler context, swappable in tests. Still no Effect syntax. |
| 3 | **The engine room** | Raw `Effect` / `@rivetkit/effect`, full power. A supported move — an Effect-native team can ignore the sugar entirely, and a level-0 team can graduate one handler at a time. |

This structure satisfies R2, R5, and R6 by construction: the entry exam is small, the upgrades are local, and nothing above your level leaks into your code until you ask for it.
