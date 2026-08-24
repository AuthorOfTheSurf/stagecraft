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
import { engine, release, retain } from "./test-harness.ts";

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
