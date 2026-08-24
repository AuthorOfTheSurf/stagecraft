/**
 * The zombie-engine reaper. `Registry.test` spawns a `rivet-engine` child,
 * and nothing guarantees it dies with us — bun's `beforeExit` doesn't fire
 * on hard exits, so every killed demo or test run can strand an engine on
 * the default port. The stranded engine then poisons the NEXT run: clients
 * connect to it, find actor records whose runner is gone, and time out with
 * `actor_ready_timeout`.
 *
 * An orphan is unambiguous: a rivet-engine whose parent pid is 1 has lost
 * the process that spawned it. Reap those before booting our own. A live
 * demo's engine still has its bun parent, so it is never touched.
 */
export function reapOrphanEngines(): void {
  try {
    const out = Bun.spawnSync(["ps", "ax", "-o", "pid=,ppid=,command="]).stdout.toString();
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+1\s+.*rivet-engine/);
      if (!m) {
        continue;
      }
      try {
        process.kill(Number(m[1]), "SIGTERM");
        console.error(`reaped orphaned rivet-engine (pid ${m[1]}) left by a previous run`);
      } catch {
        // already gone, or not ours to kill — either way, not our problem now
      }
    }
  } catch {
    // ps unavailable (unexpected on macOS/linux) — proceed without reaping
  }
}
