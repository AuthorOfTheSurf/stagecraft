/**
 * Test-harness helpers. Bun-only, and never part of a production bundle —
 * reachable solely through the `stagecraft/testing` subpath.
 *
 * `testEngine` still lives in the core barrel: it is welded to `layer.ts`
 * internals and is test-only by intent rather than by API. Move it here if
 * `layer.ts` is ever opened up for other reasons.
 */
export { reapOrphanEngines } from "./engine-hygiene.ts";
