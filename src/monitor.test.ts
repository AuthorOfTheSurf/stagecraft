/**
 * Part 2 proofs: an undeclared failure on a legal payload (1) reaches the
 * client as a typed UnexpectedError, (2) produces a context-rich report in
 * the monitor, and (3) leaves the actor alive with its state untouched.
 */
import { afterAll, expect, test } from "bun:test";
import { isUnexpected } from "./layer.ts";
import { Referee, format, monitor } from "./monitor-demo.ts";
import { engine, release, retain } from "./test-harness.ts";

retain();
afterAll(() => release());

const TIMEOUT = 120_000;
const fresh = (label: string) => `${label}-${crypto.randomUUID()}`;

test(
  "the forgotten draw: typed error, rich report, actor survives",
  async () => {
    const m = monitor();
    const referee = engine.client(Referee).getOrCreate(fresh("referee"));

    const round1 = await referee.Play({ alice: "rock", bob: "scissors" });
    expect(round1.winner).toBe("Alice");

    try {
      await referee.Play({ alice: "rock", bob: "rock" }); // legal payload, forgotten case
      throw new Error("should have thrown");
    } catch (e) {
      if (!isUnexpected(e)) throw e;
      expect(e.actor).toBe("Referee");
      expect(e.action).toBe("Play");
      expect(e.reportId).toMatch(/^[0-9a-f-]{36}$/);
    }

    expect(m.reports.length).toBe(1);
    const r = m.reports[0]!;
    expect(r.payload).toEqual({ alice: "rock", bob: "rock" });
    expect(r.state).toEqual({ scores: { Alice: { wins: 1 }, Bob: { wins: 0 } } });
    expect(r.error.message).toContain("undefined");
    expect(format(r)).toContain("Referee");

    // The actor survived, and the failed handler committed nothing.
    expect(await referee.Scores()).toEqual({ Alice: { wins: 1 }, Bob: { wins: 0 } });
    const round3 = await referee.Play({ alice: "paper", bob: "rock" });
    expect(round3.scores.Alice.wins).toBe(2);

    m.stop();
  },
  TIMEOUT,
);
