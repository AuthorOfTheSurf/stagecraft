/**
 * Monitor adapters: composable sinks for unexpected-error reports. This is
 * the "last mile" — the channel pushes reports at failure time; an adapter
 * is what carries them out of the process to where a human actually looks.
 * All names are placeholders.
 *
 *   const stop = watch(stdout(), discord({ webhookUrl }));
 */
import type { IssueEvent, IssueTracker } from "./issues.ts";
import { onUnexpected, type UnexpectedReport } from "./layer.ts";

export type MonitorAdapter = (r: UnexpectedReport) => void | Promise<void>;

/** The agent-patchable report block. */
export function format(r: UnexpectedReport): string {
  return [
    `UNEXPECTED ERROR ${r.reportId}`,
    `actor:   ${r.actor} · action: ${r.action} · at: ${new Date(r.at).toISOString()}`,
    `error:   ${r.error.name}: ${r.error.message}`,
    `payload: ${JSON.stringify(r.payload)}`,
    `state:   ${JSON.stringify(r.state)}`,
    r.error.stack ?? "(no stack)",
  ].join("\n");
}

/**
 * Attach adapters to the unexpected-error channel; returns a detach fn.
 * Adapter failures are swallowed (a broken sink must never mask a report
 * from the other sinks) but noted on stderr.
 */
export function watch(...adapters: MonitorAdapter[]): () => void {
  return onUnexpected((r) => dispatch(adapters, r));
}

/** Fan one report out to every adapter; failures logged, never propagated. */
export function dispatch(adapters: MonitorAdapter[], r: UnexpectedReport): void {
  for (const adapter of adapters) {
    Promise.resolve()
      .then(() => adapter(r))
      .catch((e) => console.error(`[monitor] adapter failed: ${e}`));
  }
}

/** The default, and the discouraged one: the report block on stderr. */
export const stdout = (): MonitorAdapter => (r) => {
  console.error(format(r));
};

const clip = (s: string, max: number) =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;

const codeBlock = (s: string, max: number) =>
  `\`\`\`\n${clip(s, max - 8)}\n\`\`\``;

const reportEmbed = (r: UnexpectedReport, title: string, color: number) => ({
  title,
  color,
  timestamp: new Date(r.at).toISOString(),
  fields: [
    { name: "payload", value: codeBlock(JSON.stringify(r.payload), 1024) },
    { name: "state", value: codeBlock(JSON.stringify(r.state), 1024) },
    { name: "stack", value: codeBlock(r.error.stack ?? "(no stack)", 1024) },
  ],
});

const postDiscord = async (webhookUrl: string, content: string, embed: unknown) => {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, embeds: [embed] }),
  });
  if (!res.ok) throw new Error(`discord webhook: HTTP ${res.status}`);
};

/**
 * Post EVERY report to a Discord channel webhook — no grouping, floods on
 * a hot loop. Prefer `alertWith(tracker, discordAlert({webhookUrl}))`.
 * Create a webhook under Server Settings → Integrations → Webhooks.
 */
export const discord = ({ webhookUrl }: { webhookUrl: string }): MonitorAdapter =>
  (r) =>
    postDiscord(
      webhookUrl,
      `🚨 **UnexpectedError** in \`${r.actor}.${r.action}\` — ${r.error.name}: ${clip(r.error.message, 300)}`,
      reportEmbed(r, `Report ${r.reportId}`, 0xe74c3c),
    );

const mrkdwnSection = (label: string, body: string) => ({
  type: "section",
  // Slack caps a section's text at 3000 chars; the fence + label eat a few.
  text: { type: "mrkdwn", text: `*${label}*\n${codeBlock(body, 2900)}` },
});

const reportBlocks = (r: UnexpectedReport, title: string) => [
  { type: "header", text: { type: "plain_text", text: clip(title, 150) } },
  {
    type: "context",
    elements: [{ type: "mrkdwn", text: `\`${r.actor}.${r.action}\` · ${new Date(r.at).toISOString()}` }],
  },
  mrkdwnSection("payload", JSON.stringify(r.payload)),
  mrkdwnSection("state", JSON.stringify(r.state)),
  mrkdwnSection("stack", r.error.stack ?? "(no stack)"),
];

const postSlack = async (webhookUrl: string, text: string, blocks: unknown[]) => {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // `text` doubles as the notification/fallback line when blocks render.
    body: JSON.stringify({ text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }, ...blocks] }),
  });
  if (!res.ok) throw new Error(`slack webhook: HTTP ${res.status}`);
};

/**
 * Post EVERY report to a Slack channel via an Incoming Webhook — no
 * grouping, floods on a hot loop. Prefer `alertWith(tracker, slackAlert({webhookUrl}))`.
 * Webhook setup: api.slack.com/apps → create app → Incoming Webhooks →
 * activate → Add New Webhook to Workspace → pick a channel → copy the URL.
 */
export const slack = ({ webhookUrl }: { webhookUrl: string }): MonitorAdapter =>
  (r) =>
    postSlack(
      webhookUrl,
      `🚨 *UnexpectedError* in \`${r.actor}.${r.action}\` — ${r.error.name}: ${clip(r.error.message, 300)}`,
      reportBlocks(r, `Report ${r.reportId}`),
    );

// ---------------------------------------------------------------------------
// Issue-level alerting (the Sentry policy): new issues and regressions
// alert; recurrences only count. Plug adapters into an issueTracker.
// ---------------------------------------------------------------------------

export type IssueAlertAdapter = (ev: IssueEvent) => void | Promise<void>;

/** Alert on new issues and regressions; recurrences stay quiet. */
export function alertWith(tracker: IssueTracker, ...adapters: IssueAlertAdapter[]): () => void {
  return tracker.on((ev) => {
    if (ev.kind === "recurrence") return;
    for (const adapter of adapters) {
      Promise.resolve()
        .then(() => adapter(ev))
        .catch((e) => console.error(`[monitor] alert adapter failed: ${e}`));
    }
  });
}

export const stdoutAlert = (): IssueAlertAdapter => (ev) => {
  const head = ev.kind === "regression"
    ? `REGRESSION — resolved issue is back (${ev.issue.count}× total): ${ev.issue.title}`
    : `NEW ISSUE: ${ev.issue.title}`;
  console.error(`${head}\n${format(ev.report)}`);
};

export const slackAlert = ({ webhookUrl }: { webhookUrl: string }): IssueAlertAdapter =>
  (ev) =>
    postSlack(
      webhookUrl,
      ev.kind === "regression"
        ? `🔥 *REGRESSION* — resolved issue is back (${ev.issue.count}× total): \`${clip(ev.issue.title, 200)}\``
        : `🆕 *New issue*: \`${clip(ev.issue.title, 200)}\``,
      reportBlocks(ev.report, `Issue ${clip(ev.issue.fingerprint, 140)}`),
    );

export const discordAlert = ({ webhookUrl }: { webhookUrl: string }): IssueAlertAdapter =>
  (ev) =>
    postDiscord(
      webhookUrl,
      ev.kind === "regression"
        ? `🔥 **REGRESSION** — resolved issue is back (${ev.issue.count}× total): \`${clip(ev.issue.title, 200)}\``
        : `🆕 **New issue**: \`${clip(ev.issue.title, 200)}\``,
      reportEmbed(ev.report, `Issue ${clip(ev.issue.fingerprint, 240)}`, ev.kind === "regression" ? 0xff5500 : 0xe74c3c),
    );
