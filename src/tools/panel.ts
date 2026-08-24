/**
 * The tiny web panel: a live view over the monitor channels. One page,
 * no dependencies, served straight from the process running the actors.
 *
 *  - Actors table (activity channel): last action, outcome, latency, and a
 *    running per-action tally —
 *    with a per-row watchdog that flags an actor QUIET when it has emitted
 *    nothing for the threshold. Silent failures become visible here.
 *  - Issues table (pass an issueTracker): defects grouped by fingerprint
 *    with counts, Sentry-style. Resolve marks one handled; if it comes
 *    back the row goes loud as a REGRESSION.
 *  - Failure feed (unexpected-error channel): the agent-patchable report
 *    blocks, newest first, streamed live over server-sent events (SSE).
 */
import { fingerprintOf, type Issue, type IssueTracker } from "../issues.ts";
import { onActivity, onUnexpected, type ActivityEvent, type UnexpectedReport } from "../layer.ts";

const MAX_REPORTS = 100;

export function startPanel({
  port = 4949,
  quietAfterMs = 30_000,
  tracker,
}: { port?: number; quietAfterMs?: number; tracker?: IssueTracker } = {}) {
  const reports: UnexpectedReport[] = [];
  const lastActivity = new Map<string, ActivityEvent>();
  // Per-instance running count of how many times each action has run. Kept on
  // the server, not the page, so a reconnecting tab gets the true totals back
  // instead of restarting from zero.
  const tallies = new Map<string, Record<string, number>>();
  const clients = new Set<(line: string) => void>();

  const push = (event: "activity" | "report" | "issue", data: unknown) => {
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const send of clients) {
      send(line);
    }
  };

  const stopActivity = onActivity((ev) => {
    const id = `${ev.actor}\u0000${ev.key}`;
    lastActivity.set(id, ev);
    const tally = { ...(tallies.get(id) ?? {}) };
    tally[ev.action] = (tally[ev.action] ?? 0) + 1;
    tallies.set(id, tally);
    push("activity", { ...ev, tally });
  });
  const stopReports = onUnexpected((r) => {
    reports.unshift(r);
    if (reports.length > MAX_REPORTS) {
      reports.pop();
    }
    // The fingerprint rides along so the page can fold duplicates.
    push("report", { ...r, fingerprint: fingerprintOf(r) });
  });
  const stopIssues = tracker?.on((ev) => push("issue", { ...ev.issue, lastKind: ev.kind }));

  const issueRow = (i: Issue) => ({ ...i, lastKind: undefined });

  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/events") {
        let send: (line: string) => void;
        const stream = new ReadableStream({
          start(controller) {
            send = (line) => {
              try {
                controller.enqueue(new TextEncoder().encode(line));
              } catch {
                clients.delete(send);
              }
            };
            clients.add(send);
            // Backlog on connect: liveness snapshot, issues, then reports oldest-first.
            for (const [id, ev] of lastActivity) {
              send(
                `event: activity\ndata: ${JSON.stringify({ ...ev, tally: tallies.get(id) })}\n\n`,
              );
            }
            if (tracker) {
              for (const i of tracker.issues.values()) {
                send(`event: issue\ndata: ${JSON.stringify(issueRow(i))}\n\n`);
              }
            }
            for (const r of [...reports].reverse()) {
              send(
                `event: report\ndata: ${JSON.stringify({ ...r, fingerprint: fingerprintOf(r) })}\n\n`,
              );
            }
          },
          cancel() {
            clients.delete(send);
          },
        });
        return new Response(stream, {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        });
      }
      if (url.pathname === "/resolve" && req.method === "POST" && tracker) {
        const fingerprint = url.searchParams.get("fp") ?? "";
        const issue = tracker.resolve(fingerprint);
        if (issue) {
          push("issue", issueRow(issue));
        }
        return new Response(issue ? "resolved" : "not found", { status: issue ? 200 : 404 });
      }
      return new Response(
        PAGE.replace("__QUIET_MS__", String(quietAfterMs))
          .replace("__QUIET_S__", String(Math.round(quietAfterMs / 1000)))
          .replace("__HAS_ISSUES__", String(Boolean(tracker))),
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    },
  });

  return {
    url: `http://localhost:${server.port}`,
    stop: () => {
      stopActivity();
      stopReports();
      stopIssues?.();
      server.stop(true);
    },
  };
}

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Actor Monitor</title>
<style>
  :root { color-scheme: dark; }
  body { background: #14161a; color: #d6dae0; font: 14px/1.5 ui-monospace, monospace; margin: 2rem; }
  h1 { font-size: 1.1rem; letter-spacing: .06em; text-transform: uppercase; color: #8b93a1; }
  table { border-collapse: collapse; margin-bottom: 2rem; min-width: 40rem; }
  th, td { text-align: left; padding: .35rem .9rem .35rem 0; border-bottom: 1px solid #262a31; }
  th { color: #8b93a1; font-weight: normal; }
  th[title] { cursor: help; border-bottom: 1px dashed #3a404a; }
  .ok { color: #7dc87d; }
  .declared-error { color: #e0b45c; }
  .unexpected-error { color: #e26d6d; font-weight: bold; }
  .quiet { color: #e26d6d; }
  .resolved { color: #7dc87d; }
  .open { color: #e26d6d; }
  .regression { color: #ff7b3d; font-weight: bold; }
  .report { background: #1b1e24; border-left: 3px solid #e26d6d; padding: .8rem 1rem; margin: .6rem 0; white-space: pre-wrap; overflow-x: auto; }
  button { background: #262a31; color: #d6dae0; border: 1px solid #3a404a; border-radius: 4px; padding: .15rem .6rem; cursor: pointer; font: inherit; }
  button:hover { background: #3a404a; }
  #empty { color: #4c525c; }
  .hint { color: #4c525c; text-transform: none; letter-spacing: 0; font-size: .8rem; }
  @keyframes tick { 0% { color: #e0b45c; font-weight: bold; } 100% { color: inherit; font-weight: inherit; } }
  .tick { animation: tick 1.2s ease-out; }
  details.group { margin: .6rem 0; }
  details.group > summary { cursor: pointer; color: #e26d6d; padding: .3rem 0; }
  details.group > summary .n { color: #8b93a1; }
  details.group .report { margin: .3rem 0 .3rem 1rem; }
</style>
<h1>Actors <span class=hint>hover any column header for what it means</span></h1>
<table><thead><tr>
<th title="The actor definition's name — the factory this instance was made from.">actor</th>
<th title="Which instance of that actor. This is the key you addressed it by (multi-part keys are joined with /). A dash means the actor is keyless.">instance</th>
<th title="The name of the most recent handler that ran on this instance.">last action</th>
<th title="How that action ended. ok = returned normally. declared-error = it threw one of the actor's own declared errors (expected, handled). unexpected-error = it threw something nobody declared — that's a defect, and it shows up in the feed below.">outcome</th>
<th title="Wall-clock time that one action took, from handler start to finish. Includes anything the handler awaited (network, LLM calls, other actors) — it is not CPU time.">latency</th>
<th title="How long ago that last action finished. It resets every time the instance does anything. If it passes the quiet threshold (__QUIET_S__s here) the row is flagged QUIET — the actor has gone silent, which is how a stuck or dead actor becomes visible.">last seen</th>
<th title="Running tally of every action this instance has run since the panel started, newest counts included. Proof of work when nothing is going wrong.">actions</th>
</tr></thead>
<tbody id="actors"></tbody></table>
<div id="issues-section" style="display:none">
<h1>Issues</h1>
<table><thead><tr>
<th title="One distinct defect. Failures are grouped by fingerprint (actor + action + error), so a hundred repeats of the same bug are one row, not a hundred.">issue</th>
<th title="open = still unhandled. resolved = you clicked Resolve. REGRESSION = you resolved it and it came back anyway.">status</th>
<th title="How many times this same defect has fired since the process started.">count</th>
<th title="When this defect was first seen in this process.">first seen</th>
<th title="The most recent time it fired.">last seen</th>
<th></th>
</tr></thead>
<tbody id="issues"></tbody></table>
</div>
<h1>Unexpected errors</h1>
<div id="empty">none yet — that's either good news or a monitoring gap</div>
<div id="reports"></div>
<script>
  const QUIET_MS = __QUIET_MS__;
  if (__HAS_ISSUES__) document.getElementById("issues-section").style.display = "";
  const actors = new Map();
  const tbody = document.getElementById("actors");
  const issuesBody = document.getElementById("issues");
  const reportsEl = document.getElementById("reports");
  const when = (t) => new Date(t).toLocaleTimeString();
  // Restart the amber tick animation even if it's still mid-fade.
  const flash = (el) => { el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick"); };

  // "takeTurn 12\u00d7, tune 1\u00d7" — busiest action first.
  const tallyText = (tally) => Object.entries(tally || {})
    .sort((a, b) => b[1] - a[1])
    .map(([action, n]) => action + " " + n + "\u00d7")
    .join(", ");

  function renderActors() {
    tbody.innerHTML = "";
    for (const [, ev] of [...actors].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      const age = Date.now() - ev.at;
      const quiet = age > QUIET_MS;
      const row = document.createElement("tr");
      row.innerHTML =
        "<td>" + ev.actor + (quiet ? " <span class=quiet>● QUIET</span>" : " <span class=ok>●</span>") + "</td>" +
        "<td>" + (ev.key || "\u2014") + "</td>" +
        "<td>" + ev.action + "</td>" +
        "<td class=" + ev.outcome + ">" + ev.outcome + "</td>" +
        "<td>" + ev.ms + "ms</td>" +
        "<td>" + Math.round(age / 1000) + "s ago</td>" +
        "<td>" + tallyText(ev.tally) + "</td>";
      tbody.appendChild(row);
    }
  }

  // Issues: rows built with DOM APIs and updated in place, keyed by
  // fingerprint. (Fingerprints contain quotes — never inline them in HTML.)
  const issueRows = new Map();
  function upsertIssue(i) {
    let row = issueRows.get(i.fingerprint);
    if (!row) {
      row = { tr: document.createElement("tr"), count: 0, cells: {} };
      for (const key of ["title", "status", "count", "first", "last", "act"]) {
        row.cells[key] = document.createElement("td");
        row.tr.appendChild(row.cells[key]);
      }
      const btn = document.createElement("button");
      btn.textContent = "Resolve";
      btn.addEventListener("click", () => fetch("/resolve?fp=" + encodeURIComponent(i.fingerprint), { method: "POST" }));
      row.cells.act.appendChild(btn);
      row.btn = btn;
      issueRows.set(i.fingerprint, row);
      issuesBody.prepend(row.tr);
    }
    row.cells.title.textContent = i.title;
    const status = row.cells.status;
    if (i.lastKind === "regression") { status.textContent = "REGRESSION"; status.className = "regression"; }
    else { status.textContent = i.status; status.className = i.status; }
    row.cells.count.textContent = i.count + "\\u00d7";
    row.cells.first.textContent = when(i.firstSeen);
    row.cells.last.textContent = when(i.lastSeen);
    row.btn.style.display = i.status === "open" ? "" : "none";
    if (i.count !== row.count) { row.count = i.count; flash(row.cells.count); }
  }

  // Failure feed: duplicates fold into one <details> group per fingerprint —
  // summary line carries the count, body holds the latest full report.
  const reportGroups = new Map();
  function addReport(r) {
    document.getElementById("empty").style.display = "none";
    const block = document.createElement("div");
    block.className = "report";
    block.textContent =
      "UNEXPECTED ERROR " + r.reportId + "\\n" +
      "actor:   " + r.actor + (r.key ? "[" + r.key + "]" : "") + " · action: " + r.action + " · at: " + new Date(r.at).toISOString() + "\\n" +
      "error:   " + r.error.name + ": " + r.error.message + "\\n" +
      "payload: " + JSON.stringify(r.payload) + "\\n" +
      "state:   " + JSON.stringify(r.state) + "\\n" +
      (r.error.stack || "(no stack)");
    let g = reportGroups.get(r.fingerprint);
    if (!g) {
      g = { count: 0, details: document.createElement("details"), label: document.createElement("span"), n: document.createElement("span"), body: document.createElement("div") };
      g.details.className = "group";
      const summary = document.createElement("summary");
      g.n.className = "n";
      summary.append(g.label, " ", g.n);
      g.details.append(summary, g.body);
      reportGroups.set(r.fingerprint, g);
    }
    g.count += 1;
    g.label.textContent = r.actor + "." + r.action + " — " + r.error.name + ": " + r.error.message;
    g.n.textContent = "\\u00d7" + g.count;
    g.body.replaceChildren(block); // keep the latest report; the count tells the rest
    reportsEl.prepend(g.details); // newest group first
    flash(g.n);
  }

  const es = new EventSource("/events");
  // On reconnect the server replays its full backlog (it may even be a new
  // process — a restarted demo behind a kept-open tab). The feed counts by
  // incrementing, so replayed reports would re-fold on top of the old
  // counts; wipe everything and let the replay rebuild the true picture.
  let connectedOnce = false;
  es.onopen = () => {
    if (!connectedOnce) { connectedOnce = true; return; }
    actors.clear();
    issueRows.clear();
    issuesBody.replaceChildren();
    reportGroups.clear();
    reportsEl.replaceChildren();
    document.getElementById("empty").style.display = "";
    renderActors();
  };
  es.addEventListener("activity", (e) => { const ev = JSON.parse(e.data); actors.set(ev.actor + "\u0000" + (ev.key || ""), ev); renderActors(); });
  es.addEventListener("issue", (e) => upsertIssue(JSON.parse(e.data)));
  es.addEventListener("report", (e) => addReport(JSON.parse(e.data)));
  setInterval(renderActors, 1000); // keep ages + quiet flags ticking
</script>`;
