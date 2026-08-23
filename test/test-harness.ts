/**
 * One engine + one registry for every effect suite in this process. Two
 * `Registry.test` instances against the same local engine clobber each
 * other's registrations, so all effect actors register here and suites
 * share the runtime via refcount.
 */
import { ChatRoom, Moderator } from "../examples/chat.ts";
import { Referee } from "../examples/monitor-demo.ts";
import { actor, testEngine } from "../src/index.ts";
import { reapOrphanEngines } from "../src/tools/testing.ts";

// Test-only actor: throws a declared error whose data uses a reserved
// Error prop name, to prove the fail() guard refuses it loudly.
export const ReservedFieldDemo = actor("reserved-field-demo", {
  state: {},
  errors: { Oops: {} as { message: string } },
  handle: {
    Trip: async (_: undefined, { fail }) => {
      throw fail.Oops({ message: "boom" });
    },
  },
});

reapOrphanEngines(); // a stranded engine from a prior run poisons this one
export const engine = testEngine(ChatRoom, Moderator, Referee, ReservedFieldDemo);

// bun loads test files one at a time, so a per-suite refcount would hit
// zero between files. Dispose exactly once, when the whole process ends.
let disposed = false;
const disposeOnce = async () => {
  if (!disposed) {
    disposed = true;
    await engine.dispose();
  }
};
process.on("beforeExit", disposeOnce);
export const retain = () => {};
export const release = () => {};
