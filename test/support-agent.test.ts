/**
 * The support-agent exhibit's user-visible behavior: a tool answer with no
 * approval, a money-touching tool parking a human approval, approve/deny
 * resolving it, a second request bouncing while one is parked, and the
 * durable expiry clock firing when no human shows up.
 */
import { afterAll, expect, test } from "bun:test";
import { SupportAgent } from "../examples/support-agent.ts";
import { engine, release, retain } from "./test-harness.ts";

retain();
afterAll(() => release());

const TIMEOUT = 120_000;
const fresh = (label: string) => `${label}-${crypto.randomUUID()}`;

test(
  "a docs question answers inline; a refund parks an approval",
  async () => {
    const agent = engine.client(SupportAgent).getOrCreate(fresh("agent-basic"));

    const chat = await agent.UserMessage({ text: "how do I return a hat?" });
    expect(chat.awaitingApproval).toBeNull();
    let transcript = await agent.GetTranscript();
    expect(transcript.some((m) => m.role === "tool" && m.text.includes("Returns & Refunds"))).toBe(
      true,
    );

    const refund = await agent.UserMessage({ text: "please refund order ord_777" });
    expect(refund.awaitingApproval).toBe("approval-1");
    const pending = await agent.GetPending();
    expect(pending?.orderId).toBe("ord_777");

    await agent.Approve({ id: "approval-1" });
    expect(await agent.GetPending()).toBeNull();
    transcript = await agent.GetTranscript();
    expect(transcript.at(-1)!.text).toBe("refund issued for ord_777");
  },
  TIMEOUT,
);

test(
  "while an approval is parked, new messages bounce typed; deny clears it",
  async () => {
    const agent = engine.client(SupportAgent).getOrCreate(fresh("agent-deny"));
    await agent.UserMessage({ text: "refund order ord_1" });

    try {
      await agent.UserMessage({ text: "also refund order ord_2" });
      throw new Error("should have thrown");
    } catch (e) {
      if (!SupportAgent.is.ApprovalPending(e)) throw e;
      expect(e.id).toBe("approval-1");
    }

    await agent.Deny({ id: "approval-1", reason: "outside the refund window" });
    const transcript = await agent.GetTranscript();
    expect(transcript.at(-1)!.text).toContain("declined by a human");

    try {
      await agent.Approve({ id: "approval-1" });
      throw new Error("should have thrown");
    } catch (e) {
      if (!SupportAgent.is.NoSuchApproval(e)) throw e;
    }
  },
  TIMEOUT,
);

test(
  "an unanswered approval expires on the durable clock",
  async () => {
    const agent = engine.client(SupportAgent).getOrCreate(fresh("agent-expiry"));
    await agent.Configure({ approvalTtlMs: 300 });
    await agent.UserMessage({ text: "refund order ord_9" });

    // Scheduled delivery is guaranteed, not fast — poll instead of sleeping.
    let pending = await agent.GetPending();
    for (let i = 0; i < 40 && pending !== null; i++) {
      await new Promise((r) => setTimeout(r, 500));
      pending = await agent.GetPending();
    }
    expect(pending).toBeNull();
    const transcript = await agent.GetTranscript();
    expect(transcript.at(-1)!.text).toContain("expired with no human response");
  },
  TIMEOUT,
);
