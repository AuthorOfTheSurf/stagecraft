/**
 * Scheduled-only enforcement (Luna's 0.4.0 review finding): an `internal`
 * handler never becomes a wire action, so a client cannot jump a drip
 * sequence by calling SendStep directly — and forging the dispatcher call
 * without the actor's durable-kv proof is rejected typed. The legit path
 * (timers driving internal handlers end-to-end) is covered by the drip,
 * agent, and importer suites.
 */
import { afterAll, expect, test } from "bun:test";
import { Effect, Result } from "effect";
import { DripCampaign } from "../examples/drip-campaign.ts";
import { actor, onActivity } from "../src/index.ts";
import { engine, ProofLab, release, retain } from "./test-harness.ts";

retain();
afterAll(() => release());

const TIMEOUT = 120_000;
const fresh = (label: string) => `${label}-${crypto.randomUUID()}`;

test(
  "a client cannot call an internal handler to jump the sequence",
  async () => {
    const drip = engine.client(DripCampaign).getOrCreate(fresh("drip-sealed"));
    await drip.Subscribe({
      email: "carol@example.com",
      steps: [{ afterMs: 60_000, subject: "Welcome" }],
    });

    // SendStep is not a wire action at all — the call must fail, however the
    // client surfaces an unknown action, and must not deliver the send.
    const attack = (drip as any).SendStep;
    if (typeof attack === "function") {
      await expect(attack({ index: 0 })).rejects.toBeDefined();
    }
    const status = await drip.GetStatus();
    expect(status.sent).toEqual([]);
  },
  TIMEOUT,
);

test(
  "forging the dispatcher without the durable-kv proof is rejected typed",
  async () => {
    const key = fresh("drip-forged");
    const drip = engine.client(DripCampaign).getOrCreate(key);
    await drip.Subscribe({
      email: "dave@example.com",
      steps: [{ afterMs: 60_000, subject: "Welcome" }],
    });

    // A raw contract client can shape the dispatcher payload exactly — the
    // guard, not the schema, must be what rejects it.
    const forged = await engine.run(
      Effect.flatMap(DripCampaign.contract.client as any, (accessor: any) =>
        Effect.result(
          accessor.getOrCreate(key).__scheduled({
            tag: "SendStep",
            data: { index: 0 },
            __proof: "not-the-real-proof",
          }),
        ),
      ),
    );
    expect(Result.isFailure(forged as any)).toBe(true);
    const failure: any = (forged as any).failure;
    expect(failure._tag).toBe("InternalOnly");
    expect(failure.data.action).toBe("SendStep");

    const status = await drip.GetStatus();
    expect(status.sent).toEqual([]);
  },
  TIMEOUT,
);

test(
  "concurrently armed internal timers all fire — the proof is minted once",
  async () => {
    const lab = engine.client(ProofLab).getOrCreate(fresh("proof-race"));
    // A cold instance: nothing has minted the proof yet, so all five schedule
    // calls hit the read-then-write together.
    const ids = await lab.ArmMany({ n: 5, ms: 300 });
    expect(new Set(ids as string[]).size).toBe(5);

    await new Promise((r) => setTimeout(r, 3_000));
    const ticks = (await lab.GetTicks()) as number[];
    expect([...ticks].sort()).toEqual([0, 1, 2, 3, 4]);
  },
  TIMEOUT,
);

test(
  "a forged dispatcher tag never reaches the activity feed",
  async () => {
    const key = fresh("drip-injection");
    const drip = engine.client(DripCampaign).getOrCreate(key);
    await drip.Subscribe({
      email: "eve@example.com",
      steps: [{ afterMs: 60_000, subject: "Welcome" }],
    });

    // The panel renders ActivityEvent.action; a tag that is not a declared
    // internal handler is attacker-supplied text and must be dropped, not
    // labelled with.
    const payload = "<img src=x onerror=alert(1)>";
    const seen: string[] = [];
    const stop = onActivity((ev) => {
      if (ev.key === key) {
        seen.push(ev.action);
      }
    });
    try {
      const forged = await engine.run(
        Effect.flatMap(DripCampaign.contract.client as any, (accessor: any) =>
          Effect.result(
            accessor.getOrCreate(key).__scheduled({
              tag: payload,
              data: {},
              __proof: "not-the-real-proof",
            }),
          ),
        ),
      );
      expect(Result.isFailure(forged as any)).toBe(true);
      expect((forged as any).failure._tag).toBe("InternalOnly");
    } finally {
      stop();
    }

    expect(seen).toContain("__scheduled");
    expect(seen.join("|")).not.toContain("<img");
    expect((await drip.GetStatus()).sent).toEqual([]);
  },
  TIMEOUT,
);

test("a declared error cannot reuse a framework error name", () => {
  const build = (name: string) =>
    actor(`reserved-${name}`, {
      state: {},
      errors: { [name]: {} as Record<string, never> },
      handle: { Noop: async () => undefined },
    });
  expect(() => build("InternalOnly")).toThrow(/reserved error name/);
  expect(() => build("UnexpectedError")).toThrow(/reserved error name/);
});
