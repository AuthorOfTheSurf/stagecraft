#!/usr/bin/env bun
/**
 * Connectivity check for the webhook adapters: post a friendly greeting
 * (or, with --example-error, a realistically-shaped error report) so a
 * developer can verify a channel is wired without running the demo and
 * waiting for real errors to flow.
 *
 *   bun run hello --slack
 *   bun run hello --discord --slack
 *   bun run hello --slack --example-error
 *
 * Same two-key rule as the demo: the flag is the intent, the env var is
 * the credential, both required.
 */
import { discord, requireWebhookUrl, slack, type UnexpectedReport } from "../index.ts";

const USAGE =
  "usage: stagecraft hello (--slack and/or --discord) [--example-error]\n" +
  "   or: bun run hello (--slack and/or --discord) [--example-error]";

type Channel = {
  flag: string;
  name: string;
  envVar: string;
  /** The real per-report adapter — used so --example-error matches production shape exactly. */
  makeAdapter: (opts: { webhookUrl: string | undefined }) => (r: UnexpectedReport) => void | Promise<void>;
  /** A plain friendly message, in the vendor's own wire format. */
  say: (webhookUrl: string, text: string) => Promise<void>;
};

const post = async (webhookUrl: string, body: unknown, vendor: string) => {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${vendor} webhook: HTTP ${res.status}`);
};

const CHANNELS: Channel[] = [
  {
    flag: "--slack",
    name: "Slack",
    envVar: "SLACK_WEBHOOK_URL",
    makeAdapter: slack,
    say: (url, text) => post(url, { text }, "slack"),
  },
  {
    flag: "--discord",
    name: "Discord",
    envVar: "DISCORD_WEBHOOK_URL",
    makeAdapter: discord,
    say: (url, text) => post(url, { content: text }, "discord"),
  },
];

const argv = process.argv.slice(2);
// `stagecraft hello --slack` and `bun run hello --slack` both land here.
const args = argv[0] === "hello" ? argv.slice(1) : argv;
const known = [...CHANNELS.map((c) => c.flag), "--example-error"];
for (const a of args) {
  if (!known.includes(a)) {
    console.error(`unknown flag ${a} — ${USAGE}`);
    process.exit(1);
  }
}

const selected = CHANNELS.filter((c) => args.includes(c.flag));
if (selected.length === 0) {
  console.error(`no channel specified — ${USAGE}`);
  process.exit(1);
}
const exampleError = args.includes("--example-error");

// Obviously fake in content, exactly real in shape.
const exampleReport: UnexpectedReport = {
  reportId: crypto.randomUUID(),
  actor: "ExampleActor",
  key: "example-1",
  action: "ExampleAction",
  payload: { example: true },
  state: { rounds: 3, scores: { Alice: 2, Bob: 1 } },
  error: {
    name: "ExampleError",
    message: "not a real incident — posted by `bun run hello --example-error` so you can see the shape",
    stack: "at exampleHandler (hello.ts)",
  },
  at: Date.now(),
};

let failed = false;
for (const channel of selected) {
  const url = process.env[channel.envVar];
  if (url === undefined) {
    console.error(`${channel.name} requested (${channel.flag}) but ${channel.envVar} is not set`);
    process.exit(1);
  }
  try {
    if (exampleError) {
      // Constructing the real adapter also validates the URL.
      await channel.makeAdapter({ webhookUrl: url })(exampleReport);
      console.log(`${channel.name}: example error posted — that's the shape real reports take`);
    } else {
      requireWebhookUrl(channel.name.toLowerCase(), url);
      await channel.say(url, `hello, world! If you can see this your ${channel.envVar} is correctly placed.`);
      console.log(`${channel.name}: greeting sent — go check the channel`);
    }
  } catch (e) {
    console.error(`${channel.name}: send failed — ${e instanceof Error ? e.message : e}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
