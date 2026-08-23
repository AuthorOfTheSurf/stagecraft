/**
 * Live demo: boots a real engine with the chat room + referee, opens the
 * monitor panel, attaches adapters, and drives traffic — including the
 * occasional two-rock round that trips the forgotten-draw bug.
 *
 *   bun run demo                       # panel + stdout alerts, no dependencies
 *   bun run demo --discord --slack     # also alert externally (env vars required)
 */
import {
  alertWith,
  discordAlert,
  issueTracker,
  reapOrphanEngines,
  slackAlert,
  startPanel,
  stdoutAlert,
  testEngine,
  type IssueAlertAdapter,
} from "../src/index.ts";
import { ChatRoom, Moderator } from "./chat.ts";

reapOrphanEngines();
import { Referee, type Choice } from "./monitor-demo.ts";

// Issue-level alerting: new issues and regressions ping; recurrences only
// count. Resolve an issue in the panel, wait for it to recur, and watch
// the regression come through loud.
const tracker = issueTracker();

// Webhook alerting is two-key: the flag is the intent, the env var is the
// credential, and opting in requires both. No flags → just the panel and
// stdout alerts, no external dependencies. A flag whose env var is missing
// or garbled kills the demo at boot — better than running like nothing is
// wrong while a requested channel is silently dead. (Runtime sink failures
// stay isolated; only *wiring* fails hard.)
const KNOWN_FLAGS = ["--discord", "--slack"] as const;
const argFlags = process.argv.slice(2);
for (const a of argFlags) {
  if (!(KNOWN_FLAGS as readonly string[]).includes(a)) {
    console.error(`unknown flag ${a} — usage: bun run demo [--discord] [--slack]`);
    process.exit(1);
  }
}

function optIn(flag: string, channel: string, envVar: string, make: (opts: { webhookUrl: string | undefined }) => IssueAlertAdapter): IssueAlertAdapter[] {
  if (!argFlags.includes(flag)) {
    console.log(`${channel} alerts off — pass ${flag} (with ${envVar} set) to enable`);
    return [];
  }
  const url = process.env[envVar];
  if (url === undefined) {
    console.error(`${channel} alerts requested (${flag}) but ${envVar} is not set`);
    process.exit(1);
  }
  try {
    const adapter = make({ webhookUrl: url });
    console.log(`${channel} alerts on`);
    return [adapter];
  } catch (e) {
    console.error(`${channel} alerts requested (${flag}) but ${envVar} is unusable: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

alertWith(
  tracker,
  stdoutAlert(),
  ...optIn("--discord", "Discord", "DISCORD_WEBHOOK_URL", discordAlert),
  ...optIn("--slack", "Slack", "SLACK_WEBHOOK_URL", slackAlert),
);

const panel = startPanel({ tracker });
console.log(`monitor panel: ${panel.url}`);

const engine = testEngine(ChatRoom, Moderator, Referee);
const referee = engine.client(Referee).getOrCreate(`arena-${crypto.randomUUID()}`);
const room = engine.client(ChatRoom).getOrCreate(`lobby-${crypto.randomUUID()}`);

await room.Initialize({ name: "Sabungan Lobby" });
await room.Join({ name: "Alice" });
await room.Join({ name: "Bob" });

const CHOICES: Choice[] = ["rock", "paper", "scissors"];
const pick = () => CHOICES[Math.floor(Math.random() * CHOICES.length)]!;

// Pacing: one RPS round per tick. Draws land ~1 in 3 ticks, the lowercase
// WinRate call every 7th, Mallory every 5th. Slow or speed it via env.
const TICK_MS = Number(process.env["DEMO_TICK_MS"] ?? 4000);
console.log(`one round every ${TICK_MS}ms (set DEMO_TICK_MS to change)`);

let round = 0;
while (true) {
  round += 1;
  const [alice, bob] = [pick(), pick()];
  try {
    const { winner } = await referee.Play({ alice, bob });
    await room.SendMessage({ sender: winner, text: `round ${round}: my ${winner === "Alice" ? alice : bob} wins!` });
  } catch {
    // the forgotten draw — already reported through the monitor channel
  }
  if (round % 7 === 0) {
    // A sloppy client sends a lowercase name — the second issue fingerprint.
    await referee.WinRate({ player: "alice" }).catch(() => {});
  }
  if (round % 5 === 0) {
    // A declared error, for contrast: shows amber in the activity table,
    // never becomes an issue.
    await room.SendMessage({ sender: "Mallory", text: "let me in" }).catch(() => {});
  }
  await new Promise((r) => setTimeout(r, TICK_MS));
}
