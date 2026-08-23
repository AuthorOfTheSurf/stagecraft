# QA: the Discord adapter

Manual test script for `discord(...)` and `discordAlert(...)`, written for a tester starting from **zero** — no bot setup, no Discord developer portal application needed.

Good news up front: **you don't need the Discord desktop app or a bot token.** Everything here works in a browser with a standard incoming webhook.

## Part 1 — Get a Discord server & channel (skip what you already have)

1. **Sign in to Discord.** Go to [discord.com](https://discord.com) in your browser. Free tier is fine.
2. **Create a test server.** On the left sidebar, click the **+** button (**Add a Server**) → **Create My Own** → **For me and my friends** → Name it anything (`stagecraft-qa`).
3. **Pick or create a channel** for alerts, e.g. `#alerts` (click **+** next to Text Channels).

> 💡 **Gotchas & Permissions Note:**
> - Webhooks require a **Discord Server (Guild)**. They cannot be created in direct messages (DMs) or group chats.
> - On a server you own (like the free test server above), webhook creation is always available—**no Discord Nitro required**.
> - If using an existing shared or corporate server, you need the **Manage Webhooks** permission on the channel or server. If a channel is set to private and you lack webhook permissions, the **Integrations** tab will be hidden.

## Part 2 — Create an Incoming Webhook

1. Hover over your `#alerts` channel in the channel list and click the **Gear icon** (⚙️ **Edit Channel**).
   *(Alternatively: click the Server Name at top-left → **Server Settings** → **Integrations**)*
2. In the channel settings menu, click **Integrations** → **Webhooks** → **New Webhook** (or **Create Webhook**).
3. Name it (`stagecraft-monitor`) and select the target channel (`#alerts`).
4. Click **Copy Webhook URL**. It looks like `https://discord.com/api/webhooks/1234567890/abcde-fgh...`.
5. Click **Save Changes** and close the settings modal.

> ⚠️ **The URL is a credential.** Anyone holding it can post messages directly into your channel. Don't commit it; put it in a gitignored `.env.local` (bun auto-loads it). When you're done testing, delete the webhook (same page, trash icon).

Smoke-test the webhook by itself before touching stagecraft:

```sh
curl -X POST -H 'Content-Type: application/json' \
  --data '{"content":"hello from the QA script"}' \
  "$DISCORD_WEBHOOK_URL"
```

Expected: HTTP 204 No Content and the message appears in your channel.

Or skip curl and use the built-in connectivity check once the repo is installed (Part 3's `.env.local` in place): `bun run hello --discord` posts a friendly greeting; add `--example-error` to see the exact rich embed shape a real error report takes.

## Part 3 — Test through the demo

```sh
cd ~/Repos/stagecraft
bun install
cp .env.example .env.local   # gitignored; paste your webhook URL(s) in
bun run demo --discord
```

Checklist:

- [ ] Startup prints `Discord alerts on` — the adapter attached.
- [ ] Two-key negative cases: `bun run demo --discord` with the env var unset or invalid dies at boot (exit 1) with a message naming the flag and the var — and never echoing the URL value; `bun run demo` without the flag ignores the env var entirely.
- [ ] Within a few rounds, a **🆕 New issue** embed lands in the channel: red/amber embed border, `Referee.Play` title, then formatted code blocks for `payload`, `state`, and `stack`.
- [ ] Around round 7, a **second, different issue** arrives (the lowercase `WinRate` call). Recurrences of either issue must **not** post — watch the panel counts climb at `http://localhost:4949` while Discord stays quiet.
- [ ] In the panel, click **Resolve** on the draw issue, wait a few rounds: a **🔥 REGRESSION** embed arrives with the updated status.
- [ ] Mallory's declared error (every 5th round) never reaches Discord — declared errors are contract, not incidents.
- [ ] Stop the demo, replace the webhook with a syntactically valid but non-working URL, and rerun: stderr shows `[monitor] alert adapter failed: … HTTP 4xx` and the demo keeps running — a broken sink must never take the process down or mask stdout alerts.

## Part 4 — Automated coverage

`bun test src/adapters.test.ts` covers the payload shape offline (stubbed fetch): Discord Embed limits (title ≤256 chars, description ≤4096 chars, field values ≤1024 chars), JSON formatting, and broken-sink isolation. Live posting is deliberately left to this manual script — the suite never spams a real webhook.
