/**
 * A durable AI agent session with a human in the loop — one actor per
 * conversation. The transcript and any parked approval live in actor state,
 * so the session survives restarts; `schedule.after` is the approval-expiry
 * clock. The model call is a deterministic stand-in (`decide`) so the
 * exhibit runs offline — in a real app that function is your streamText /
 * Claude call, and the actor around it does not change.
 */
import { actor } from "../src/index.ts";

export type AgentMessage = {
  role: "user" | "agent" | "tool";
  text: string;
  at: number;
};

export type PendingApproval = {
  id: string;
  tool: "refundOrder";
  orderId: string;
  requestedAt: number;
  /** The expiry timer, cancelled when a human resolves the approval. */
  timerId: string;
};

// --- Tools ------------------------------------------------------------

// Runs without approval: read-only, cheap to be wrong about.
const searchDocs = (query: string) =>
  `docs: "${query}" — see the Returns & Refunds policy, section 2.`;

// Approval-gated: irreversible, touches money. The actor parks the call
// instead of executing it.
const refundOrder = (orderId: string) => `refund issued for ${orderId}`;

// --- The "model" -------------------------------------------------------

// Stand-in policy for the exhibit. Real apps replace this one function with
// an LLM call; the tool-approval machinery below is model-agnostic.
const decide = (
  text: string,
):
  | { kind: "reply"; text: string }
  | { kind: "search"; query: string }
  | {
      kind: "refund";
      orderId: string;
    } => {
  const refund = text.match(/refund order (\S+)/i);
  if (refund) {
    return { kind: "refund", orderId: refund[1]! };
  }
  if (/policy|docs|how do i/i.test(text)) {
    return { kind: "search", query: text };
  }
  return { kind: "reply", text: "Happy to help — what do you need?" };
};

export const SupportAgent = actor("SupportAgent", {
  state: {
    messages: [] as AgentMessage[],
    pending: null as PendingApproval | null,
    approvalTtlMs: 60_000,
    nextApprovalId: 1,
  },
  events: {
    reply: {} as AgentMessage,
    approvalRequested: {} as PendingApproval,
    approvalResolved: {} as { id: string; outcome: "approved" | "denied" | "expired" },
  },
  errors: {
    ApprovalPending: {} as { id: string },
    NoSuchApproval: {} as { id: string },
  },
  handle: {
    Configure: async ({ approvalTtlMs }: { approvalTtlMs: number }, { state }) => {
      state.approvalTtlMs = approvalTtlMs;
    },

    UserMessage: async ({ text }: { text: string }, { state, emit, schedule, fail }) => {
      if (state.pending) {
        throw fail.ApprovalPending({ id: state.pending.id });
      }
      state.messages.push({ role: "user", text, at: Date.now() });

      const action = decide(text);

      if (action.kind === "search") {
        state.messages.push({ role: "tool", text: searchDocs(action.query), at: Date.now() });
      }

      if (action.kind === "refund") {
        const id = `approval-${state.nextApprovalId++}`;
        const timerId = await schedule.after(state.approvalTtlMs).ExpireApproval({ id });
        state.pending = {
          id,
          tool: "refundOrder",
          orderId: action.orderId,
          requestedAt: Date.now(),
          timerId,
        };
        emit.approvalRequested(state.pending);
        const reply: AgentMessage = {
          role: "agent",
          text: `A refund for ${action.orderId} needs a human sign-off (${id}).`,
          at: Date.now(),
        };
        state.messages.push(reply);
        emit.reply(reply);
        return { awaitingApproval: id };
      }

      const reply: AgentMessage = {
        role: "agent",
        text:
          action.kind === "search"
            ? `Here's what I found: ${searchDocs(action.query)}`
            : action.text,
        at: Date.now(),
      };
      state.messages.push(reply);
      emit.reply(reply);
      return { awaitingApproval: null };
    },

    Approve: async ({ id }: { id: string }, { state, emit, schedule, fail }) => {
      if (!state.pending || state.pending.id !== id) {
        throw fail.NoSuchApproval({ id });
      }
      await schedule.cancel(state.pending.timerId);
      const result = refundOrder(state.pending.orderId);
      state.pending = null;
      const reply: AgentMessage = { role: "agent", text: result, at: Date.now() };
      state.messages.push(reply);
      emit.reply(reply);
      emit.approvalResolved({ id, outcome: "approved" });
    },

    Deny: async (
      { id, reason }: { id: string; reason: string },
      { state, emit, schedule, fail },
    ) => {
      if (!state.pending || state.pending.id !== id) {
        throw fail.NoSuchApproval({ id });
      }
      await schedule.cancel(state.pending.timerId);
      state.pending = null;
      const reply: AgentMessage = {
        role: "agent",
        text: `The refund was declined by a human: ${reason}`,
        at: Date.now(),
      };
      state.messages.push(reply);
      emit.reply(reply);
      emit.approvalResolved({ id, outcome: "denied" });
    },

    // Resolved approvals cancel their timer, so this normally fires only for
    // a genuinely unanswered request. The id check stays as the backstop for
    // a fire already in flight when the cancel landed.
    ExpireApproval: async ({ id }: { id: string }, { state, emit }) => {
      if (!state.pending || state.pending.id !== id) {
        return;
      }
      state.pending = null;
      const reply: AgentMessage = {
        role: "agent",
        text: `The approval request ${id} expired with no human response.`,
        at: Date.now(),
      };
      state.messages.push(reply);
      emit.reply(reply);
      emit.approvalResolved({ id, outcome: "expired" });
    },

    GetTranscript: async (_: void, { state }) => state.messages,
    GetPending: async (_: void, { state }) => state.pending,
  },
});
