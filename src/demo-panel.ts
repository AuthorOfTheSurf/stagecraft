/**
 * Live demo: boots a real engine with the chat room + referee, opens the
 * monitor panel, attaches adapters, and drives traffic — including the
 * occasional two-rock round that trips the forgotten-draw bug.
 *
 *   bun src/actors/proposed-simple-sdk/demo-panel.ts
 *   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/… bun src/actors/proposed-simple-sdk/demo-panel.ts
 */
import { alertWith, discordAlert, slackAlert, stdoutAlert } from "./adapters.ts";
import { ChatRoom, Moderator } from "./chat.ts";
import { reapOrphanEngines } from "./engine-hygiene.ts";
import { issueTracker } from "./issues.ts";
import { testEngine } from "./layer.ts";

reapOrphanEngines();
import { Referee, type Choice } from "./monitor-demo.ts";
import { startPanel } from "./panel.ts";

// Issue-level alerting: new issues and regressions ping; recurrences only
// count. Resolve an issue in the panel, wait for it to recur, and watch
// the regression come through loud.
const tracker = issueTracker();
const discordUrl = process.env["DISCORD_WEBHOOK_URL"];
const slackUrl = process.env["SLACK_WEBHOOK_URL"];
alertWith(
  tracker,
  stdoutAlert(),
  ...(discordUrl ? [discordAlert({ webhookUrl: discordUrl })] : []),
  ...(slackUrl ? [slackAlert({ webhookUrl: slackUrl })] : []),
);
if (!discordUrl) console.log("(set DISCORD_WEBHOOK_URL to also alert to Discord)");
if (!slackUrl) console.log("(set SLACK_WEBHOOK_URL to also alert to Slack)");

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
