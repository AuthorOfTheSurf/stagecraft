/**
 * stagecraft — plain actors on Rivet, with the production run smoothly.
 *
 * The core: define actors with plain async handlers; get durable state,
 * one-message-at-a-time semantics, typed errors, scheduling, and events
 * without learning the underlying Effect machinery first.
 *
 * The crew: an unexpected-error channel with agent-patchable reports,
 * Sentry-style issue grouping, pluggable alert sinks, and a live panel.
 */
export {
  actor,
  testEngine,
  onUnexpected,
  onActivity,
  isUnexpected,
  type Ctx,
  type ActorDef,
  type AnyActorDef,
  type UnexpectedReport,
  type ActivityEvent,
} from "./layer.ts";

export {
  watch,
  dispatch,
  format,
  stdout,
  discord,
  alertWith,
  stdoutAlert,
  discordAlert,
  type MonitorAdapter,
  type IssueAlertAdapter,
} from "./adapters.ts";

export {
  issueTracker,
  fingerprintOf,
  type Issue,
  type IssueEvent,
  type IssueStatus,
  type IssueTracker,
} from "./issues.ts";

export { startPanel } from "./panel.ts";
export { reapOrphanEngines } from "./engine-hygiene.ts";
