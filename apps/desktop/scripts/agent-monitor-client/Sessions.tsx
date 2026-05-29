/**
 * @file Sessions.tsx
 * @description Displays a list of all recorded sessions with filtering,
 * searching, and pagination features.
 */

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  Search,
  ChevronRight,
  RefreshCw,
  SortDesc,
  SortAsc,
  ChevronDown,
  Play,
} from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { SessionStatusBadge, HarnessBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { formatDateTime, formatDuration, truncate, fmtCost } from "../lib/format";
import { effectiveSessionStatus, isSessionAwaitingInput } from "../lib/types";
import type { Session, DashboardEvent } from "../lib/types";

const PAGE_SIZE = 10;
export function Sessions() {
  const navigate = useNavigate();
  const { t } = useTranslation("sessions");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const [cwd, setCwd] = useState("");
  const [sortBy, setSortBy] = useState("time");
  const [sortDesc, setSortDesc] = useState(true);
  const [directories, setDirectories] = useState<string[]>([]);
  const [dashboardRunIds, setDashboardRunIds] = useState<Set<string>>(new Set());
  const [harness, setHarness] = useState("");

  const HARNESS_OPTIONS: Array<{ label: string; value: string }> = [
    { label: "All Harnesses", value: "" },
    { label: "Claude", value: "claude" },
    { label: "Codex", value: "codex" },
    { label: "Cursor", value: "cursor" },
    { label: "Copilot", value: "copilot" },
    { label: "OpenCode", value: "opencode" },
  ];

  const FILTER_OPTIONS: Array<{ label: string; value: string }> = [
    { label: t("filterAll"), value: "" },
    { label: t("filterActive"), value: "active" },
    { label: t("filterWaiting"), value: "waiting" },
    { label: t("filterCompleted"), value: "completed" },
    { label: t("filterError"), value: "error" },
    { label: t("filterAbandoned"), value: "abandoned" },
  ];

  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    api.sessions
      .facets()
      .then((res) => {
        setDirectories(res.cwds);
      })
      .catch(console.error);
  }, []);

  const load = useCallback(async () => {
    try {
      if (filter === "waiting") {
        const res = await api.sessions.list({
          status: "active",
          q: search || undefined,
          cwd: cwd || undefined,
          harness: harness || undefined,
          sort_by: sortBy,
          sort_desc: sortDesc,
          limit: 10000,
          offset: 0,
        });
        let rows = res.sessions;
        rows = rows.filter(isSessionAwaitingInput);
        setTotal(rows.length);
        setSessions(rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));
        return;
      }
      const params: {
        status?: string;
        q?: string;
        cwd?: string;
        harness?: string;
        sort_by?: string;
        sort_desc?: boolean;
        limit: number;
        offset: number;
      } = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        sort_by: sortBy,
        sort_desc: sortDesc,
      };
      if (filter) params.status = filter;
      if (search) params.q = search;
      if (cwd) params.cwd = cwd;
      if (harness) params.harness = harness;
      const res = await api.sessions.list(params);
      setSessions(res.sessions);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [filter, harness, search, cwd, sortBy, sortDesc, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(0);
  }, [filter, harness, search, cwd, sortBy, sortDesc]);

  useEffect(() => {
    return eventBus.subscribe((msg) => {
      if (msg.type === "session_created" || msg.type === "session_updated") {
        load();
      }
      if (msg.type === "new_event") {
        const ev = msg.data as DashboardEvent;
        if (ev.event_type === "Stop" || ev.event_type === "SessionEnd") {
          load();
        }
      }
      if (msg.type === "run_status") {
        loadDashboardRuns();
      }
    });
  }, [load]);

  const loadDashboardRuns = useCallback(() => {
    api.run
      .list()
      .then((r) => {
        const ids = new Set<string>();
        for (const h of r.items) {
          if (h.sessionId) ids.add(h.sessionId);
        }
        setDashboardRunIds(ids);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadDashboardRuns();
    const t = setInterval(loadDashboardRuns, 15000);
    return () => clearInterval(t);
  }, [loadDashboardRuns]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const wsConnected = useSyncExternalStore(eventBus.onConnection, () => eventBus.connected);

  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
            <FolderOpen className="w-4.5 h-4.5 text-accent" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-gray-100">{t("title")}</h1>
              {wsConnected ? (
                <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
                  {t("common:live")}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[11px] text-gray-400 bg-gray-500/10 border border-gray-500/20 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                  {t("common:offline")}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500" data-testid="audit-sessions-list-total">
              {t("sessionCount", { count: total })}
              {filter ? ` ${filter}` : ""}
            </p>
          </div>
        </div>
        <button onClick={load} className="btn-ghost flex-shrink-0">
          <RefreshCw className="w-4 h-4" /> {t("common:refresh")}
        </button>
      </div>

      <div className="mb-6 bg-surface-2/40 p-2 rounded-xl border border-border w-full">
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px] max-w-[340px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="input w-full pl-10"
            />
          </div>

          <div className="relative shrink-0 w-[180px]">
            <select
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              className="input w-full text-ellipsis bg-surface-1 pr-9 appearance-none cursor-pointer"
            >
              <option value="">All Directories</option>
              {directories.map((d) => (
                <option key={d} value={d} title={d}>
                  {truncate(d, 30)}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
          </div>

          <div className="flex items-center gap-1.5 bg-surface-1 px-1.5 py-1 rounded-lg border border-border h-[38px] flex-1 min-w-[180px]">
            <div className="relative flex-1">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-transparent w-full text-xs text-gray-200 outline-none pl-3 pr-8 appearance-none cursor-pointer whitespace-nowrap"
              >
                <option value="time">Sort by Time ({sortDesc ? "Newest" : "Oldest"})</option>
                <option value="duration">
                  Sort by Duration ({sortDesc ? "Longest" : "Shortest"})
                </option>
                <option value="price">Sort by Price ({sortDesc ? "Highest" : "Lowest"})</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
            </div>
            <div className="w-px h-4 bg-border mx-1" />
            <button
              onClick={() => setSortDesc(!sortDesc)}
              className="p-1.5 rounded hover:bg-surface-3 text-gray-400 hover:text-gray-200 transition-colors shrink-0"
              title={sortDesc ? "Descending" : "Ascending"}
            >
              {sortDesc ? <SortDesc className="w-4 h-4" /> : <SortAsc className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3 overflow-x-auto pb-1">
          <div className="flex gap-1 bg-surface-1 rounded-lg p-1 border border-border shrink-0 min-w-max">
            {HARNESS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setHarness(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  harness === opt.value
                    ? "bg-surface-4 text-gray-200"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex gap-1 bg-surface-1 rounded-lg p-1 border border-border shrink-0 min-w-max">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filter === opt.value
                    ? "bg-surface-4 text-gray-200"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!loading && sessions.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={t("noSessions")}
          description={search || filter || cwd ? t("noSessionsDesc") : t("noSessionsHint")}
        />
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tableSession")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tableStatus")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tableLastActive")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tableDuration")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tableAgents")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tableCost")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tableDirectory")}
                  </th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sessions.map((session) => (
                  <tr
                    key={session.id}
                    onClick={() => navigate(`/sessions/${session.id}`)}
                    className="hover:bg-surface-4 transition-colors cursor-pointer group"
                  >
                    <td className="px-5 py-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-200">
                            {session.name || `${t("defaultName")}${session.id.slice(0, 8)}`}
                          </p>
                          <HarnessBadge harness={session.harness} />
                          {dashboardRunIds.has(session.id) && (
                            <Link
                              to={`/run?session=${encodeURIComponent(session.id)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 hover:text-emerald-200 px-1.5 py-0.5 rounded-full transition-colors"
                              title={t("dashboardRunBadge", "Driven by Run page · click to open")}
                            >
                              <Play className="w-2.5 h-2.5" />
                              {t("common:dashboardRun", "Run")}
                            </Link>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-600 font-mono">
                          {session.id.slice(0, 12)}
                        </p>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <SessionStatusBadge status={effectiveSessionStatus(session)} />
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-400">
                      {formatDateTime(session.last_activity || session.started_at)}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-400 font-mono">
                      {session.ended_at
                        ? formatDuration(session.started_at, session.ended_at)
                        : t("common:running")}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-400">
                      {session.agent_count ?? "-"}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-400 font-mono">
                      {session.cost != null && session.cost > 0 ? fmtCost(session.cost) : "-"}
                    </td>
                    <td
                      className="px-5 py-4 text-[11px] text-gray-500 font-mono"
                      title={session.cwd || undefined}
                    >
                      {session.cwd ? truncate(session.cwd, 30) : "-"}
                    </td>
                    <td className="px-3 py-4">
                      <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 px-1">
              <span className="text-xs text-gray-500">
                {t("common:pagination.showing", {
                  from: page * PAGE_SIZE + 1,
                  to: Math.min((page + 1) * PAGE_SIZE, total),
                  total,
                })}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-surface-2 text-gray-400 hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t("common:pagination.previous")}
                </button>
                <span className="px-3 py-1.5 text-xs text-gray-500">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-surface-2 text-gray-400 hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t("common:pagination.next")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
