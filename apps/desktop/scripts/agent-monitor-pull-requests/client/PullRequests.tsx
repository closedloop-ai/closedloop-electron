/**
 * @file PullRequests.tsx — dedicated cross-session pull-request browser
 * (FEA-1226). Lists PRs captured from Claude Code / Codex / ClosedLoop-loop
 * session logs (command-gated to `gh pr create` output). The default view is
 * one row per session that produced a PR — the session↔PR association the
 * cloud cannot otherwise see for non-loop PRs. Build-copied into the pinned
 * client as src/pages/PullRequests.tsx by build-agent-monitor.mjs.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface PullRequest {
  id: string;
  pr_url: string;
  pr_number: number;
  repo_full_name: string;
  branch_name: string | null;
  head_sha: string | null;
  title: string | null;
  harness: string;
  observed_at: string;
  session_id?: string;
}

interface SessionRow {
  session_id: string | null;
  session_name: string | null;
  session_started_at: string | null;
  session_cwd: string | null;
  pr_count: number;
  last_pr_at: string;
  harness: string;
  pull_requests: PullRequest[];
}

interface Stats {
  pull_requests: number;
  sessions_with_pull_requests: number;
  repos: number;
}

function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

/**
 * Open a captured PR on GitHub. The dashboard runs in a sandboxed iframe, so
 * an <a target="_blank"> cannot reliably reach the browser — the sidecar opens
 * it via the OS handler (POST /api/pull-requests/:id/open).
 */
function openPr(id: string): void {
  fetch(`/api/pull-requests/${encodeURIComponent(id)}/open`, {
    method: "POST",
  }).catch(() => {
    /* best-effort — nothing actionable if the sidecar is unreachable */
  });
}

function PrChip({ pr }: { pr: PullRequest }) {
  return (
    <button
      type="button"
      onClick={() => openPr(pr.id)}
      title={pr.title ? `${pr.repo_full_name}#${pr.pr_number} — ${pr.title}` : pr.pr_url}
      className="inline-flex items-center gap-1 rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/20"
    >
      {pr.repo_full_name}#{pr.pr_number}
    </button>
  );
}

export function PullRequests() {
  const [view, setView] = useState<"sessions" | "prs">("sessions");
  const [stats, setStats] = useState<Stats | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, sessionsRes, prsRes] = await Promise.all([
        fetch("/api/pull-requests/stats"),
        fetch("/api/pull-requests/sessions?limit=500"),
        fetch("/api/pull-requests?limit=500"),
      ]);
      if (!statsRes.ok || !sessionsRes.ok || !prsRes.ok) {
        throw new Error("Failed to load pull-request data");
      }
      const statsData = await statsRes.json();
      const sessionsData = await sessionsRes.json();
      const prsData = await prsRes.json();
      setStats(statsData);
      setSessions(Array.isArray(sessionsData.sessions) ? sessionsData.sessions : []);
      setPrs(Array.isArray(prsData.pull_requests) ? prsData.pull_requests : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">Pull Requests</h1>
          <p className="text-xs text-gray-500">
            PRs created from Claude Code, Codex &amp; ClosedLoop-loop sessions —
            each linked to the session that produced it.
          </p>
        </div>
        <button
          onClick={load}
          className="flex-shrink-0 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-surface-3"
        >
          Refresh
        </button>
      </div>

      {/* Summary — the at-a-glance counts (mirrors the Dashboard tile). */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { label: "Pull Requests", value: stats?.pull_requests },
          { label: "Sessions w/ PRs", value: stats?.sessions_with_pull_requests },
          { label: "Repositories", value: stats?.repos },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-border bg-surface-2 px-4 py-3"
          >
            <div className="text-2xl font-semibold text-gray-100">
              {s.value ?? "—"}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {error}
        </div>
      )}

      <div className="mb-3 inline-flex rounded-lg border border-border bg-surface-2 p-0.5 text-xs">
        {(["sessions", "prs"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-md px-3 py-1 transition-colors ${
              view === v ? "bg-accent/15 text-accent" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {v === "sessions" ? "By session" : "By PR"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : view === "sessions" ? (
        sessions.length === 0 ? (
          <p className="text-xs italic text-gray-500">
            No pull requests captured yet. Create a PR with{" "}
            <span className="font-mono">gh pr create</span> in a Claude Code or
            Codex session.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-2 text-[10px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Session</th>
                  <th className="px-3 py-2">Started</th>
                  <th className="px-3 py-2">Pull Requests</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.session_id || s.last_pr_at}
                    className="border-t border-border bg-surface-1 align-top"
                  >
                    <td className="px-3 py-2">
                      {s.session_name && s.session_id ? (
                        <Link
                          to={`/sessions/${s.session_id}`}
                          className="font-medium text-accent hover:underline"
                        >
                          {s.session_name}
                        </Link>
                      ) : (
                        <div className="font-medium text-gray-100">
                          {s.session_id || "(unimported session)"}
                        </div>
                      )}
                      {s.session_cwd && (
                        <div className="font-mono text-[10px] text-gray-500 truncate">
                          {s.session_cwd}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-400">
                      {fmt(s.session_started_at)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {s.pull_requests.map((pr) => (
                          <PrChip key={pr.id} pr={pr} />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : prs.length === 0 ? (
        <p className="text-xs italic text-gray-500">No pull requests captured yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-2 text-[10px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Pull Request</th>
                <th className="px-3 py-2">Branch</th>
                <th className="px-3 py-2">Harness</th>
                <th className="px-3 py-2">Captured</th>
              </tr>
            </thead>
            <tbody>
              {prs.map((pr) => (
                <tr key={pr.id} className="border-t border-border bg-surface-1">
                  <td className="px-3 py-2">
                    <PrChip pr={pr} />
                    {pr.title && (
                      <span className="ml-2 text-gray-400">{pr.title}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-400">
                    {pr.branch_name || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-gray-300">
                      {pr.harness}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-400">{fmt(pr.observed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
