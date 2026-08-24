/**
 * The Sentry policy, engine-free: same defect groups by fingerprint; new
 * alerts, recurrences count quietly, resolve + return = loud regression.
 */
import { expect, test } from "bun:test";
import { fingerprintOf, issueTracker } from "./issues.ts";
import type { UnexpectedReport } from "./layer.ts";

const report = (over: Partial<UnexpectedReport> = {}): UnexpectedReport => ({
  reportId: crypto.randomUUID(),
  actor: "Referee",
  key: "match-1",
  action: "Play",
  payload: { alice: "rock", bob: "rock" },
  state: {},
  error: { name: "TypeError", message: "undefined is not an object", stack: "at Play" },
  at: Date.now(),
  ...over,
});

test("fingerprint groups the same defect across ids, times, and digits", () => {
  const a = fingerprintOf(report({ error: { name: "TypeError", message: "row 42 missing" } }));
  const b = fingerprintOf(
    report({ error: { name: "TypeError", message: "row 7 missing" }, at: 1 }),
  );
  expect(a).toBe(b);
  const other = fingerprintOf(report({ action: "WinRate" }));
  expect(other).not.toBe(a);
});

test("new alerts, recurrence counts quietly, resolve + return = regression", () => {
  const tracker = issueTracker();
  const kinds: string[] = [];
  tracker.on((ev) => kinds.push(ev.kind));

  tracker.ingest(report());
  tracker.ingest(report());
  tracker.ingest(report());
  expect(kinds).toEqual(["new", "recurrence", "recurrence"]);

  const issue = [...tracker.issues.values()][0]!;
  expect(issue.count).toBe(3);
  expect(issue.status).toBe("open");

  tracker.resolve(issue.fingerprint);
  expect(issue.status).toBe("resolved");

  tracker.ingest(report());
  expect(kinds.at(-1)).toBe("regression");
  expect(issue.status).toBe("open"); // reopened — the resolve was wrong
  expect(issue.count).toBe(4);

  tracker.stop();
});

test("distinct defects become distinct issues", () => {
  const tracker = issueTracker();
  tracker.ingest(report());
  tracker.ingest(report({ action: "WinRate", error: { name: "TypeError", message: "other" } }));
  expect(tracker.issues.size).toBe(2);
  tracker.stop();
});
