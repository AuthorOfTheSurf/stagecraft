/**
 * A realtime batch importer — one actor per upload. Rows and the cursor
 * live in durable state, so a crash mid-import resumes from the last
 * committed chunk instead of restarting; `emit.progress` streams
 * rows-done/errors to a frontend (or the live panel) with no separate
 * realtime service. The work loop chains itself with `schedule.after(0)` —
 * one chunk per transaction, never awaiting its own instance.
 */
import { actor } from "../src/index.ts";

export type RowError = { line: number; raw: string; reason: string };
export type ImportStatus = "receiving" | "running" | "done";

const CHUNK_SIZE = 25;

// The exhibit's "database write": parse a `sku,qty` line or say why not.
const importLine = (raw: string): { sku: string; qty: number } => {
  const [sku, qty] = raw.split(",").map((s) => s.trim());
  if (!sku) throw new RangeError("missing sku");
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`bad qty "${qty}"`);
  return { sku, qty: n };
};

export const CsvImporter = actor("CsvImporter", {
  state: {
    lines: [] as string[],
    cursor: 0,
    imported: 0,
    errors: [] as RowError[],
    status: "receiving" as ImportStatus,
  },
  events: {
    progress: {} as { processed: number; total: number; imported: number; failed: number },
    completed: {} as { total: number; imported: number; failed: number },
  },
  errors: {
    AlreadyStarted: {} as { status: ImportStatus },
    NothingToImport: {},
  },
  handle: {
    // Uploads arrive in as many Append calls as the client likes.
    Append: async ({ lines }: { lines: string[] }, { state, fail }) => {
      if (state.status !== "receiving") throw fail.AlreadyStarted({ status: state.status });
      state.lines.push(...lines);
      return { total: state.lines.length };
    },

    Start: async (_: void, { state, schedule, fail }) => {
      if (state.status !== "receiving") throw fail.AlreadyStarted({ status: state.status });
      if (state.lines.length === 0) throw fail.NothingToImport({});
      state.status = "running";
      schedule.after(0).Work();
      return { total: state.lines.length };
    },

    // One chunk per message. The cursor commits with the chunk, so replayed
    // or resumed work never double-imports a committed row.
    Work: async (_: void, { state, emit, schedule }) => {
      if (state.status !== "running") return; // stale timer after completion
      const end = Math.min(state.cursor + CHUNK_SIZE, state.lines.length);
      for (; state.cursor < end; state.cursor++) {
        const raw = state.lines[state.cursor]!;
        try {
          importLine(raw);
          state.imported++;
        } catch (e) {
          state.errors.push({
            line: state.cursor + 1,
            raw,
            reason: e instanceof Error ? e.message : String(e),
          });
        }
      }
      emit.progress({
        processed: state.cursor,
        total: state.lines.length,
        imported: state.imported,
        failed: state.errors.length,
      });
      if (state.cursor < state.lines.length) {
        schedule.after(0).Work();
      } else {
        state.status = "done";
        emit.completed({
          total: state.lines.length,
          imported: state.imported,
          failed: state.errors.length,
        });
      }
    },

    GetStatus: async (_: void, { state }) => ({
      status: state.status,
      processed: state.cursor,
      total: state.lines.length,
      imported: state.imported,
      errors: state.errors,
    }),
  },
});
