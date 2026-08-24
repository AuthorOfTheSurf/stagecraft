/**
 * Sentry-style issue grouping over the unexpected-error channel. Every
 * report matters, but reports of the same defect group into one ISSUE by
 * fingerprint. Alerting policy:
 *
 *   - new issue        → alert (first occurrence of a defect)
 *   - recurrence       → count it, stay quiet (no flooding)
 *   - regression       → alert LOUDLY (it was marked resolved and came back)
 *
 * Resolving is the "handled" gesture: mark the issue fixed, and the system
 * holds you to it.
 */
import { onUnexpected, type UnexpectedReport } from "./layer.ts";

export type IssueStatus = "open" | "resolved";

export type Issue = {
  fingerprint: string;
  /** Human handle: "Referee.Play — TypeError: undefined is not an object…" */
  title: string;
  status: IssueStatus;
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** The first report in the group — the reproduction brief. */
  sample: UnexpectedReport;
};

export type IssueEvent = {
  kind: "new" | "recurrence" | "regression";
  issue: Issue;
  report: UnexpectedReport;
};

/**
 * Group key: where it happened + what kind of error. Digits are stripped
 * from the message so ids/counts/offsets don't split one defect into many
 * groups (the same trick Sentry's message-based grouping uses).
 */
export function fingerprintOf(r: UnexpectedReport): string {
  const normalized = r.error.message.replace(/\d+/g, "#").slice(0, 200);
  return `${r.actor}.${r.action}:${r.error.name}:${normalized}`;
}

export function issueTracker() {
  const issues = new Map<string, Issue>();
  const listeners = new Set<(ev: IssueEvent) => void>();

  const emit = (ev: IssueEvent) => {
    for (const fn of listeners) {
      try {
        fn(ev);
      } catch {
        /* a broken listener must not mask the event */
      }
    }
  };

  const ingest = (report: UnexpectedReport) => {
    const fingerprint = fingerprintOf(report);
    const existing = issues.get(fingerprint);
    if (!existing) {
      const issue: Issue = {
        fingerprint,
        title: `${report.actor}.${report.action} — ${report.error.name}: ${report.error.message.slice(0, 120)}`,
        status: "open",
        count: 1,
        firstSeen: report.at,
        lastSeen: report.at,
        sample: report,
      };
      issues.set(fingerprint, issue);
      emit({ kind: "new", issue, report });
      return;
    }
    existing.count += 1;
    existing.lastSeen = report.at;
    if (existing.status === "resolved") {
      existing.status = "open"; // it came back — the resolve was wrong
      emit({ kind: "regression", issue: existing, report });
    } else {
      emit({ kind: "recurrence", issue: existing, report });
    }
  };

  const stop = onUnexpected(ingest);

  return {
    /** Live map of all issues, keyed by fingerprint. */
    issues,
    /** Subscribe to issue events; returns an unsubscribe fn. */
    on(fn: (ev: IssueEvent) => void): () => void {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    /** Mark an issue handled. If it recurs, that's a loud regression. */
    resolve(fingerprint: string): Issue | undefined {
      const issue = issues.get(fingerprint);
      if (issue) {
        issue.status = "resolved";
      }
      return issue;
    },
    /** Direct feed for tests; the live channel calls this too. */
    ingest,
    stop,
  };
}

export type IssueTracker = ReturnType<typeof issueTracker>;
