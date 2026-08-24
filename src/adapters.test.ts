/**
 * Adapter proofs, engine-free: a hand-built report through each adapter.
 * The Discord adapter runs against a stubbed fetch (live spamming of a
 * real webhook is demo-panel.ts's job, not the suite's).
 */
import { expect, test } from "bun:test";
import { discord, discordAlert, dispatch, format, slack, slackAlert, stdout } from "./adapters.ts";
import type { UnexpectedReport } from "./layer.ts";

const report: UnexpectedReport = {
  reportId: "00000000-0000-0000-0000-000000000000",
  actor: "Referee",
  key: "match-1",
  action: "Play",
  payload: { alice: "rock", bob: "rock" },
  state: { scores: { Alice: { wins: 1 }, Bob: { wins: 0 } } },
  error: {
    name: "TypeError",
    message: "undefined is not an object",
    stack: "at Play (monitor-demo.ts:32)",
  },
  at: 1755861990013,
};

test("format carries everything an agent needs", () => {
  const block = format(report);
  for (const needle of ["Referee", "Play", "rock", "wins", "TypeError", "monitor-demo.ts:32"]) {
    expect(block).toContain(needle);
  }
});

test("stdout adapter prints the block", () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (s: string) => void lines.push(s);
  try {
    stdout()(report);
  } finally {
    console.error = original;
  }
  expect(lines.join("\n")).toContain("UNEXPECTED ERROR");
});

test("discord adapter posts a webhook payload under Discord's limits", async () => {
  let captured: { url: string; body: any } | undefined;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    await discord({ webhookUrl: "https://discord.com/api/webhooks/test" })(report);
  } finally {
    globalThis.fetch = original;
  }
  expect(captured!.url).toContain("discord.com");
  expect(captured!.body.content).toContain("Referee.Play");
  const embed = captured!.body.embeds[0];
  expect(embed.fields.map((f: any) => f.name)).toEqual(["payload", "state", "stack"]);
  for (const f of embed.fields) {
    expect(f.value.length).toBeLessThanOrEqual(1024);
  }
});

test("slack adapter posts Block Kit under Slack's limits", async () => {
  let captured: { url: string; body: any } | undefined;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  try {
    await slack({ webhookUrl: "https://hooks.slack.com/services/T000/B000/test" })(report);
  } finally {
    globalThis.fetch = original;
  }
  expect(captured!.url).toContain("hooks.slack.com");
  expect(captured!.body.text).toContain("Referee.Play"); // notification fallback line
  const blocks = captured!.body.blocks;
  expect(blocks.length).toBeLessThanOrEqual(50); // Slack's block cap
  const header = blocks.find((b: any) => b.type === "header");
  expect(header.text.text.length).toBeLessThanOrEqual(150); // header text cap
  const sections = blocks.filter((b: any) => b.type === "section" && b.text?.type === "mrkdwn");
  for (const s of sections) {
    expect(s.text.text.length).toBeLessThanOrEqual(3000);
  } // section text cap
  const joined = sections.map((s: any) => s.text.text).join("\n");
  for (const needle of ["payload", "state", "stack", "rock", "wins"]) {
    expect(joined).toContain(needle);
  }
});

test("webhook adapters fail fast at construction on a missing or garbled URL", () => {
  for (const make of [slack, discord, slackAlert, discordAlert]) {
    expect(() => make({ webhookUrl: undefined })).toThrow(/missing or empty/);
    expect(() => make({ webhookUrl: "" })).toThrow(/missing or empty/);
    // a paste that lost its scheme (the classic terminal line-wrap casualty) —
    // and the message must never echo the value (it's a credential)
    let msg = "";
    try {
      make({ webhookUrl: "hooks.slack.com/services/T000/B000/SECRETPART" });
    } catch (e) {
      msg = String(e);
    }
    expect(msg).toContain("doesn't look like a URL");
    expect(msg).not.toContain("SECRETPART");
    expect(() => make({ webhookUrl: "ftp://hooks.slack.com/x" })).toThrow(/http/);
    expect(() => make({ webhookUrl: "https://example.com/anything" })).not.toThrow(); // vendor-neutral: any http(s) URL constructs
  }
});

test("dispatch fans one report out to every adapter; a broken sink doesn't mask the rest", async () => {
  const seen: string[] = [];
  const quiet = console.error;
  console.error = () => {};
  try {
    dispatch(
      [
        () => {
          throw new Error("broken sink");
        },
        (r) => void seen.push(r.reportId),
      ],
      report,
    );
    await new Promise((r) => setTimeout(r, 10));
  } finally {
    console.error = quiet;
  }
  expect(seen).toEqual([report.reportId]);
});
