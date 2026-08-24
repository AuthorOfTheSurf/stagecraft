/**
 * Timer cancellation, proven by behavior (stagecraft#33): schedule.after hands
 * back a durable timer id, schedule.cancel revokes a live timer so it never
 * fires, and every stale form of cancel — double, unknown id, after the
 * fire — reports false instead of throwing.
 */
import { afterAll, expect, test } from "bun:test";
import { engine, release, retain, TimerLab } from "./test-harness.ts";

retain();
afterAll(() => release());

const TIMEOUT = 120_000;
const fresh = (label: string) => `${label}-${crypto.randomUUID()}`;

test(
  "a cancelled timer never fires",
  async () => {
    const lab = engine.client(TimerLab).getOrCreate(fresh("lab-cancel"));

    const { timerId } = await lab.Arm({ ms: 2_000, tag: "doomed" });
    expect(typeof timerId).toBe("string");

    const { cancelled } = await lab.Cancel({ timerId });
    expect(cancelled).toBe(true);

    // Outlive the fire time generously before declaring it dead.
    await new Promise((r) => setTimeout(r, 4_000));
    expect(await lab.GetFired()).toEqual([]);
  },
  TIMEOUT,
);

test(
  "stale cancels report false: double-cancel, unknown id, after the fire",
  async () => {
    const lab = engine.client(TimerLab).getOrCreate(fresh("lab-stale"));

    const { timerId } = await lab.Arm({ ms: 60_000, tag: "parked" });
    expect((await lab.Cancel({ timerId })).cancelled).toBe(true);
    expect((await lab.Cancel({ timerId })).cancelled).toBe(false);
    expect((await lab.Cancel({ timerId: "no-such-timer" })).cancelled).toBe(false);

    const armed = await lab.Arm({ ms: 100, tag: "lands" });
    // Scheduled delivery is guaranteed, not fast — poll instead of sleeping.
    let fired = await lab.GetFired();
    for (let i = 0; i < 40 && fired.length < 1; i++) {
      await new Promise((r) => setTimeout(r, 250));
      fired = await lab.GetFired();
    }
    expect(fired).toEqual(["lands"]);
    expect((await lab.Cancel({ timerId: armed.timerId })).cancelled).toBe(false);
  },
  TIMEOUT,
);
