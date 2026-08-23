import { describe, expect, it } from "bun:test";
import { engine, Slowpoke } from "./test-harness.ts";

// @rivetkit/effect forwards only name/icon to rivetkit, so stagecraft applies
// the rest itself. These assert the knob is genuinely in force, not just
// accepted and dropped — the failure mode we are guarding against is silence.
describe("runtime options", () => {
  const client = engine.client(Slowpoke);

  it("honors a lowered actionTimeout", async () => {
    const slow = client.getOrCreate(`slow-${crypto.randomUUID()}`);
    // 800ms against a 300ms cap: only the applied option can stop this.
    await expect(slow.Dawdle(800)).rejects.toThrow();
  });

  it("still lets an action inside the cap finish", async () => {
    const quick = client.getOrCreate(`quick-${crypto.randomUUID()}`);
    expect(await quick.Dawdle(10)).toBe("finished");
  });
});
