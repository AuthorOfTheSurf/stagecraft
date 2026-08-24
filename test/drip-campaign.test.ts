/**
 * The drip exhibit's user-visible behavior: a per-subscriber sequence
 * running on durable timers to completion in order, and unsubscribe
 * turning the already-scheduled next send into a no-op (the guard is
 * the cancellation).
 */
import { afterAll, expect, test } from "bun:test";
import { DripCampaign } from "../examples/drip-campaign.ts";
import { engine, release, retain } from "./test-harness.ts";

retain();
afterAll(() => release());

const TIMEOUT = 120_000;
const fresh = (label: string) => `${label}-${crypto.randomUUID()}`;

test(
  "a three-step sequence sends in order and completes",
  async () => {
    const drip = engine.client(DripCampaign).getOrCreate(fresh("drip-full"));
    const { scheduled } = await drip.Subscribe({
      email: "alice@example.com",
      steps: [
        { afterMs: 100, subject: "Welcome" },
        { afterMs: 100, subject: "Getting started" },
        { afterMs: 100, subject: "Pro tips" },
      ],
    });
    expect(scheduled).toBe(3);

    // Scheduled delivery is guaranteed, not fast — poll instead of sleeping.
    let status = await drip.GetStatus();
    for (let i = 0; i < 40 && status.status !== "completed"; i++) {
      await new Promise((r) => setTimeout(r, 500));
      status = await drip.GetStatus();
    }
    expect(status.status).toBe("completed");
    expect(status.sent.map((s) => s.subject)).toEqual(["Welcome", "Getting started", "Pro tips"]);
    expect(status.remaining).toBe(0);
  },
  TIMEOUT,
);

test(
  "unsubscribe stops the sequence; the parked timer fires as a no-op",
  async () => {
    const drip = engine.client(DripCampaign).getOrCreate(fresh("drip-unsub"));
    await drip.Subscribe({
      email: "bob@example.com",
      steps: [
        { afterMs: 100, subject: "Welcome" },
        { afterMs: 5_000, subject: "Should never send" },
      ],
    });

    // Wait for the first send so we cut the sequence mid-flight.
    let status = await drip.GetStatus();
    for (let i = 0; i < 40 && status.sent.length < 1; i++) {
      await new Promise((r) => setTimeout(r, 250));
      status = await drip.GetStatus();
    }
    expect(status.sent.map((s) => s.subject)).toEqual(["Welcome"]);

    const { sentBeforeLeaving } = await drip.Unsubscribe();
    expect(sentBeforeLeaving).toBe(1);

    // Outlive the second step's timer, then prove it delivered nothing.
    await new Promise((r) => setTimeout(r, 6_000));
    status = await drip.GetStatus();
    expect(status.status).toBe("unsubscribed");
    expect(status.sent.map((s) => s.subject)).toEqual(["Welcome"]);

    try {
      await drip.Unsubscribe();
      throw new Error("should have thrown");
    } catch (e) {
      if (!DripCampaign.is.NotSubscribed(e)) {
        throw e;
      }
    }
  },
  TIMEOUT,
);
