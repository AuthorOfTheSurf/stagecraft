/**
 * stagecraft — plain actors on Rivet, with the production run smoothly.
 *
 * The core: define actors with plain async handlers; get durable state,
 * one-message-at-a-time semantics, typed errors, scheduling, and events
 * without learning the underlying Effect machinery first.
 *
 * The crew: an unexpected-error channel with agent-patchable reports,
 * Sentry-style issue grouping, and pluggable alert sinks.
 *
 * The backstage tools are Bun-only and live behind their own doors, so a
 * consumer never pulls them into a build that cannot run them:
 *   stagecraft/panel   — the live monitor panel
 *   stagecraft/testing — test-harness helpers
 */
export {
  actor,
  testEngine,
  onUnexpected,
  onActivity,
  isUnexpected,
  isInternalOnly,
  type Ctx,
  type ActorDef,
  type AnyActorDef,
  type UnexpectedReport,
  type ActivityEvent,
  type RuntimeOptions,
} from "./layer.ts";

export {
  watch,
  dispatch,
  format,
  stdout,
  discord,
  slack,
  requireWebhookUrl,
  alertWith,
  stdoutAlert,
  discordAlert,
  slackAlert,
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
