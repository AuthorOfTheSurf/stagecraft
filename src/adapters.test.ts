/**
 * Adapter proofs, engine-free: a hand-built report through each adapter.
 * The Discord adapter runs against a stubbed fetch (live spamming of a
 * real webhook is demo-panel.ts's job, not the suite's).
 */
import { expect, test } from "bun:test";
import { discord, dispatch, format, stdout } from "./adapters.ts";
import type { UnexpectedReport } from "./layer.ts";

const report: UnexpectedReport = {
  reportId: "00000000-0000-0000-0000-000000000000",
  actor: "Referee",
  action: "Play",
  payload: { alice: "rock", bob: "rock" },
  state: { scores: { Alice: { wins: 1 }, Bob: { wins: 0 } } },
  error: { name: "TypeError", message: "undefined is not an object", stack: "at Play (monitor-demo.ts:32)" },
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
  for (const f of embed.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
});

test("dispatch fans one report out to every adapter; a broken sink doesn't mask the rest", async () => {
  const seen: string[] = [];
  const quiet = console.error;
  console.error = () => {};
  try {
    dispatch(
      [
        () => { throw new Error("broken sink"); },
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
