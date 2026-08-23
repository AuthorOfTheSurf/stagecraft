/**
 * A per-subscriber drip sequence — one actor per subscriber, each carrying
 * its own durable clock. This is the workload where cron + database gets
 * ugly (thousands of independent per-entity timers) and an actor is the
 * honest shape: `self.after(step.afterMs)` schedules the next send, the
 * schedule survives restarts, and Unsubscribe is just a state flag the
 * next timer respects. The delivery call (`deliver`) is a stand-in for
 * Resend/SES; swap it without touching the actor.
 */
import { actor } from "../src/index.ts";

export type DripStep = { afterMs: number; subject: string };
export type SentEmail = { subject: string; at: number };
export type DripStatus = "idle" | "active" | "unsubscribed" | "completed";

// The exhibit's email provider.
const deliver = (email: string, subject: string) => `sent "${subject}" to ${email}`;

export const DripCampaign = actor("DripCampaign", {
  state: {
    email: "",
    steps: [] as DripStep[],
    sent: [] as SentEmail[],
    nextIndex: 0,
    status: "idle" as DripStatus,
  },
  events: {
    emailSent: {} as { subject: string; index: number },
    sequenceCompleted: {} as { sent: number },
    unsubscribed: {} as { email: string },
  },
  errors: {
    AlreadySubscribed: {} as { email: string },
    NotSubscribed: {},
    EmptySequence: {},
  },
  handle: {
    Subscribe: async (
      { email, steps }: { email: string; steps: DripStep[] },
      { state, self, fail },
    ) => {
      if (state.status !== "idle") throw fail.AlreadySubscribed({ email: state.email });
      if (steps.length === 0) throw fail.EmptySequence({});
      state.email = email;
      state.steps = steps;
      state.status = "active";
      self.after(steps[0]!.afterMs).SendStep({ index: 0 });
      return { scheduled: steps.length };
    },

    // Durable timers can't be revoked in v0, so every send re-checks state:
    // an unsubscribe or an already-advanced index turns the firing into a
    // no-op. The guard is the cancellation.
    SendStep: async ({ index }: { index: number }, { state, emit, self }) => {
      if (state.status !== "active" || index !== state.nextIndex) return;
      const step = state.steps[index]!;
      deliver(state.email, step.subject);
      state.sent.push({ subject: step.subject, at: Date.now() });
      emit.emailSent({ subject: step.subject, index });
      state.nextIndex++;
      const next = state.steps[state.nextIndex];
      if (next) {
        self.after(next.afterMs).SendStep({ index: state.nextIndex });
      } else {
        state.status = "completed";
        emit.sequenceCompleted({ sent: state.sent.length });
      }
    },

    Unsubscribe: async (_: void, { state, emit, fail }) => {
      if (state.status !== "active") throw fail.NotSubscribed({});
      state.status = "unsubscribed";
      emit.unsubscribed({ email: state.email });
      return { sentBeforeLeaving: state.sent.length };
    },

    GetStatus: async (_: void, { state }) => ({
      status: state.status,
      email: state.email,
      sent: state.sent,
      remaining: state.steps.length - state.nextIndex,
    }),
  },
});
