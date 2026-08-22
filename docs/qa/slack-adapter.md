# QA: the Slack adapter

Manual test script for `slack(...)` and `slackAlert(...)`, written for a tester starting from **zero** — no Slack account, no Slack app installed.

Good news up front: **you don't need the Slack desktop app.** Everything here works in a browser. Install the app later if you like it.

## Part 1 — Get a Slack workspace (skip what you already have)

1. **Create a Slack account.** Go to [slack.com/get-started](https://slack.com/get-started) and sign up with an email. Free tier is fine.
2. **Create a workspace.** During signup Slack walks you through "Create a Workspace" — name it anything (`stagecraft-qa` works). You'll land in the workspace in your browser.
3. **Pick or make a channel** for alerts, e.g. create `#alerts` (left sidebar → **+ Add channels** → Create). The default `#general` also works.
4. *(Optional)* Install the Slack desktop app from [slack.com/downloads](https://slack.com/downloads) and sign in to the same workspace — alerts will pop as native notifications instead of browser tabs.

## Part 2 — Create an Incoming Webhook

Slack webhooks live inside a "Slack app" you create for your own workspace. This takes ~3 minutes:

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. Name it (`stagecraft-monitor`), pick your workspace, **Create App**.
3. In the app's sidebar: **Incoming Webhooks** → toggle **Activate Incoming Webhooks** to On.
4. Scroll down → **Add New Webhook to Workspace** → choose your channel (`#alerts`) → **Allow**.
5. Copy the **Webhook URL**. It looks like `https://hooks.slack.com/services/T…/B…/…`.

> ⚠️ **The URL is a credential.** Anyone holding it can post to your channel. Don't commit it; put it in a gitignored `.env.local` (bun auto-loads it). When you're done testing, delete the webhook (same page, trash icon) or delete the whole app.

Smoke-test the webhook by itself before touching stagecraft:

```sh
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"hello from the QA script"}' \
  "$SLACK_WEBHOOK_URL"
```

Expected: `ok` on stdout and the message appears in your channel.

## Part 3 — Test through the demo

```sh
cd ~/Repos/stagecraft
bun install
cp .env.example .env.local   # gitignored; paste your webhook URL(s) in
bun run demo --slack
```

Checklist:

- [ ] Startup prints `Slack alerts on` — the adapter attached.
- [ ] Two-key negative cases: `bun run demo --slack` with the env var unset or garbled dies at boot (exit 1) with a message naming the flag and the var — and never echoing the URL value; `bun run demo` without the flag ignores the env var entirely.
- [ ] Within a few rounds, a **🆕 New issue** message lands in the channel: header block, `Referee.Play` context line, then `payload` / `state` / `stack` code sections.
- [ ] Around round 7, a **second, different issue** arrives (the lowercase `WinRate` call). Recurrences of either issue must **not** post — watch the panel counts climb at `http://localhost:4949` while Slack stays quiet.
- [ ] In the panel, click **Resolve** on the draw issue, wait a few rounds: a **🔥 REGRESSION** message arrives.
- [ ] Mallory's declared error (every 5th round) never reaches Slack — declared errors are contract, not incidents.
- [ ] Kill the demo, edit `.env.local` to a garbage URL, rerun: stderr shows `[monitor] alert adapter failed: … HTTP 4xx` and the demo keeps running — a broken sink must never take the process down or mask stdout alerts.

## Part 4 — Automated coverage

`bun test src/adapters.test.ts` covers the payload shape offline (stubbed fetch): Block Kit limits (≤50 blocks, header ≤150 chars, sections ≤3000 chars), the notification fallback `text` line, and broken-sink isolation. Live posting is deliberately left to this manual script — the suite never spams a real webhook.
