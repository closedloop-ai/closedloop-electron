/**
 * @file Dashboard.tsx
 * @description ClosedLoop-authored override that merges the upstream Analytics
 * page into the Monitor tab. Copied verbatim over
 * `src/pages/Dashboard.tsx` at build time by scripts/build-agent-monitor.mjs
 * via CLIENT_FULL_FILE_OVERRIDES.
 *
 * Layout (Monitor tab):
 *   1. Five stat pills (Sessions / Agents / Tokens / Cost / Events)
 *   2. Active Agents section (full width)
 *   3. Event Activity heatmap + Last 30 Days sparkline
 *   4. Inner tabs: Cost / Tokens / Productivity / Workflow
 *
 * Health tab carries the upstream SystemHealthTab unchanged.
 *
 * Helpers from the upstream Analytics page (ChartTooltip, useTooltip, Heatmap,
 * Sparkline, CostTrendLine, BarRow, CostBarRow, DonutChart, StatPill) are
 * duplicated locally here rather than imported — Analytics.tsx does not export
 * them, and inlining keeps the override a single self-contained file.
 */

import {
  useEffect,
  useState,
  useCallback,
  useSyncExternalStore,
  useMemo,
  useRef,
} from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  FolderOpen,
  Bot,
  Zap,
  DollarSign,
  Activity,
  ArrowRight,
  RefreshCw,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Server,
  HardDrive,
  Plug,
  Cpu,
  BarChart3,
  ShieldCheck,
  Database,
  Search,
  Clock,
} from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { AgentCard } from "../components/AgentCard";
import { EmptyState } from "../components/EmptyState";
import { Tip } from "../components/Tip";
import { fmt, fmtCost, fmtCostFull, formatModelName } from "../lib/format";
import type {
  Stats,
  Agent,
  WSMessage,
  WorkflowData,
  Analytics as AnalyticsData,
  CostResult,
} from "../lib/types";

// ─── Analytics chart tooltip ──────────────────────────────────────────────────

function ChartTooltip({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
}) {
  const nearRight = x > window.innerWidth - 200;
  return (
    <div
      className="fixed z-50 px-2 py-1.5 text-xs bg-[#12121f] border border-[#2a2a4a] rounded shadow-xl text-gray-200 pointer-events-none whitespace-nowrap"
      style={{
        left: nearRight ? x - 14 : x + 14,
        top: y - 10,
        transform: nearRight ? "translateX(-100%)" : undefined,
      }}
    >
      {children}
    </div>
  );
}

function useTooltip() {
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    content: React.ReactNode;
  } | null>(null);

  const show = (e: React.MouseEvent, content: React.ReactNode) => {
    setTooltip({ x: e.clientX, y: e.clientY, content });
  };
  const move = (e: React.MouseEvent) => {
    setTooltip((t) => t && { ...t, x: e.clientX, y: e.clientY });
  };
  const hide = () => setTooltip(null);

  const node = tooltip ? (
    <ChartTooltip x={tooltip.x} y={tooltip.y}>
      {tooltip.content}
    </ChartTooltip>
  ) : null;

  return { show, move, hide, node };
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────

function cellColor(count: number, max: number) {
  if (count === 0) return "#161625";
  const t = Math.log(count + 1) / Math.log(Math.max(max, 1) + 1);
  type RGB = [number, number, number];
  const stops: RGB[] = [
    [22, 20, 60],
    [55, 48, 163],
    [99, 102, 241],
    [199, 210, 254],
  ];
  const scaled = t * (stops.length - 1);
  const lo = Math.min(Math.floor(scaled), stops.length - 2);
  const frac = scaled - lo;
  const [r1, g1, b1]: RGB = stops[lo] as RGB;
  const [r2, g2, b2]: RGB = stops[lo + 1] as RGB;
  const r = Math.round(r1 + (r2 - r1) * frac);
  const g = Math.round(g1 + (g2 - g1) * frac);
  const b = Math.round(b1 + (b2 - b1) * frac);
  return `rgb(${r},${g},${b})`;
}

function Heatmap({
  weeks,
  locale,
}: {
  weeks: Array<Array<{ date: string; count: number }>>;
  locale: string;
}) {
  const { show, move, hide, node } = useTooltip();

  const monthLabels = useMemo(
    () =>
      Array.from({ length: 12 }, (_, month) =>
        new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(2026, month, 1))
      ),
    [locale]
  );

  const dayNames = useMemo(
    () =>
      Array.from({ length: 7 }, (_, day) =>
        new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
          new Date(2026, 0, 4 + day)
        )
      ),
    [locale]
  );

  const dayLabels = [dayNames[0], "", dayNames[2], "", dayNames[4], "", ""];
  const maxCount = Math.max(...weeks.flatMap((w) => w.map((c) => c.count)), 1);

  const monthPositions = useMemo(() => {
    const positions: Array<{ label: string; col: number }> = [];
    let prevMonth = -1;
    weeks.forEach((week, wi) => {
      const firstCell = week[0];
      if (!firstCell) return;
      const parts = firstCell.date.split("-").map(Number);
      const m = (parts[1] || 1) - 1;
      if (m !== prevMonth) {
        positions.push({ label: monthLabels[m] ?? "", col: wi });
        prevMonth = m;
      }
    });
    return positions;
  }, [weeks, monthLabels]);

  return (
    <div className="relative">
      {node}
      <div className="flex mb-2 ml-[32px] relative h-4">
        {monthPositions.map((mp, i) => (
          <div
            key={i}
            className="absolute text-[10px] text-gray-600 font-medium whitespace-nowrap"
            style={{ left: mp.col * 16 }}
          >
            {mp.label}
          </div>
        ))}
      </div>
      <div className="flex" style={{ gap: "3px" }}>
        <div className="flex flex-col mr-1 w-7" style={{ gap: "3px" }}>
          {dayLabels.map((d, i) => (
            <div
              key={i}
              className="text-[9px] text-gray-700 flex items-center justify-end pr-1.5"
              style={{ height: 13 }}
            >
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col" style={{ gap: "3px" }}>
            {week.map((cell) => (
              <div
                key={cell.date}
                onMouseEnter={(e) => {
                  const parts = cell.date.split("-").map(Number);
                  const y = parts[0] || 0;
                  const m = (parts[1] || 1) - 1;
                  const d = parts[2] || 1;
                  const date = new Date(y, m, d, 12);
                  const dow = date.getDay();
                  show(
                    e,
                    <>
                      <span className="text-gray-400">
                        {dayNames[dow] ?? ""}, {cell.date}
                      </span>
                      <span className="ml-2 font-medium">
                        {cell.count.toLocaleString()} events
                      </span>
                    </>
                  );
                }}
                onMouseMove={move}
                onMouseLeave={hide}
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: 2,
                  backgroundColor: cellColor(cell.count, maxCount),
                  border: "1px solid rgba(255,255,255,0.04)",
                  flexShrink: 0,
                  cursor: "default",
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3 text-[11px] text-gray-600">
        <span>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = Math.round(f * maxCount);
          return (
            <div
              key={f}
              style={{
                width: 13,
                height: 13,
                borderRadius: 2,
                backgroundColor: cellColor(v, maxCount),
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            />
          );
        })}
        <span>More</span>
      </div>
    </div>
  );
}

// ─── Sparkline + cost trend ───────────────────────────────────────────────────

function Sparkline({
  data,
  color = "#6366f1",
}: {
  data: Array<{ date: string; count: number }>;
  color?: string;
}) {
  const { show, move, hide, node } = useTooltip();
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="relative flex items-end gap-px h-16">
      {node}
      {data.map(({ date, count }) => (
        <div
          key={date}
          className="flex-1 rounded-sm transition-all cursor-default"
          style={{
            height: `${Math.max(4, Math.round((count / max) * 100))}%`,
            backgroundColor: color,
            opacity: count === 0 ? 0.15 : 0.85,
          }}
          onMouseEnter={(e) =>
            show(
              e,
              <>
                <span className="text-gray-400">{date}</span>
                <span className="ml-2 font-medium">{count.toLocaleString()} events</span>
              </>
            )
          }
          onMouseMove={move}
          onMouseLeave={hide}
        />
      ))}
    </div>
  );
}

function CostTrendLine({
  data,
  color = "#10b981",
}: {
  data: Array<{ date: string; cost: number }>;
  color?: string;
}) {
  const { show, move, hide, node } = useTooltip();
  if (data.length === 0) return null;

  const width = 320;
  const height = 88;
  const padX = 8;
  const padY = 8;
  const min = Math.min(...data.map((d) => d.cost), 0);
  const max = Math.max(...data.map((d) => d.cost), 0);
  const span = Math.max(max - min, 0.0001);
  const step = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;

  const points = data.map(({ date, cost }, i) => {
    const x = padX + i * step;
    const y = height - padY - ((cost - min) / span) * (height - padY * 2);
    return { date, cost, x, y };
  });

  const linePoints = points.map((p) => `${p.x},${p.y}`).join(" ");
  const firstX = points[0]?.x ?? padX;
  const lastX = points[points.length - 1]?.x ?? padX;
  const areaPoints = `${firstX},${height - padY} ${linePoints} ${lastX},${height - padY}`;

  return (
    <div className="relative">
      {node}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[88px] overflow-visible">
        <defs>
          <linearGradient id="daily-cost-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <polyline points={areaPoints} fill="url(#daily-cost-fill)" stroke="none" />
        <polyline
          points={linePoints}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((point) => (
          <g key={point.date}>
            <circle
              cx={point.x}
              cy={point.y}
              r={2.5}
              fill={color}
              style={{ pointerEvents: "none" }}
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={8}
              fill="transparent"
              onMouseEnter={(e) =>
                show(
                  e,
                  <>
                    <span className="text-gray-400">{point.date}</span>
                    <span className="ml-2 font-medium">{fmtCostFull(point.cost)}</span>
                  </>
                )
              }
              onMouseMove={move}
              onMouseLeave={hide}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─── Bar rows + donut ─────────────────────────────────────────────────────────

function BarRow({
  label,
  count,
  max,
  color = "bg-accent",
  pct,
}: {
  label: string;
  count: number;
  max: number;
  color?: string;
  pct?: number;
}) {
  const width = pct !== undefined ? pct : max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400 w-28 truncate flex-shrink-0" title={label}>
        {label}
      </span>
      <div className="flex-1 bg-surface-3 rounded-full h-2">
        <div
          className={`${color} h-2 rounded-full transition-all`}
          style={{ width: `${width}%` }}
        />
      </div>
      <Tip raw={count.toLocaleString()}>
        <span className="text-xs text-gray-500 w-10 text-right flex-shrink-0">{fmt(count)}</span>
      </Tip>
    </div>
  );
}

function CostBarRow({
  label,
  cost,
  max,
  color = "bg-emerald-400",
}: {
  label: string;
  cost: number;
  max: number;
  color?: string;
}) {
  const width = max > 0 ? Math.max(2, Math.round((cost / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400 w-24 truncate flex-shrink-0" title={label}>
        {label}
      </span>
      <div className="flex-1 bg-surface-3 rounded-full h-2">
        <div
          className={`${color} h-2 rounded-full transition-all`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="text-xs text-emerald-400 font-mono w-16 text-right flex-shrink-0">
        <Tip raw={fmtCostFull(cost)}>{fmtCost(cost)}</Tip>
      </span>
    </div>
  );
}

function DonutChart({
  segments,
  formatTotal,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  formatTotal?: (total: number) => string;
}) {
  const { show, move, hide, node } = useTooltip();
  const total = segments.reduce((s, g) => s + g.value, 0);
  if (total === 0) return <div className="text-xs text-gray-500">No data</div>;

  const r = 52;
  const cx = 64;
  const cy = 64;
  const stroke = 18;
  const circumference = 2 * Math.PI * r;

  let offset = circumference / 4;
  return (
    <div className="flex items-center justify-center gap-6 w-full">
      {node}
      <svg width={128} height={128} viewBox="0 0 128 128" className="flex-shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e1e2e" strokeWidth={stroke} />
        {segments.map(({ label, value, color }, i) => {
          const dash = (value / total) * circumference;
          const gap = circumference - dash;
          const pct = Math.round((value / total) * 100);
          const currentOffset = offset;
          offset -= dash;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={currentOffset}
              style={{ cursor: "default" }}
              onMouseEnter={(e) =>
                show(
                  e,
                  <>
                    <span style={{ color }}>{label}</span>
                    <span className="ml-2 font-medium">{pct}%</span>
                  </>
                )
              }
              onMouseMove={move}
              onMouseLeave={hide}
            />
          );
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" className="fill-gray-300" fontSize={11}>
          {(formatTotal ?? fmt)(total)}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" className="fill-gray-600" fontSize={9}>
          total
        </text>
      </svg>
      <div className="space-y-2">
        {segments.map(({ label, value, color }) => (
          <div key={label} className="flex items-center gap-2 text-xs">
            <span
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-gray-400">{label}</span>
            <span className="text-gray-500 ml-auto pl-4">
              {Math.round((value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── StatPill ─────────────────────────────────────────────────────────────────

function StatPill({
  label,
  value,
  raw,
  sub,
  icon: Icon,
  color = "text-accent",
  testid,
  subTestid,
}: {
  label: string;
  value: string | number;
  raw?: string;
  sub?: string;
  icon: React.ElementType;
  color?: string;
  testid?: string;
  subTestid?: string;
}) {
  return (
    <div className="card p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <p className={`text-2xl font-bold ${color}`} data-testid={testid}>
        {raw ? <Tip raw={raw}>{value}</Tip> : value}
      </p>
      {sub && (
        <p className="text-[11px] text-gray-500" data-testid={subTestid}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ─── SystemHealthTab (preserved verbatim from upstream Dashboard) ─────────────

interface SystemInfo {
  db: {
    path: string;
    size: number;
    counts: Record<string, number>;
    pragmas: {
      journal_mode: string;
      synchronous: number;
      auto_vacuum: number;
      encoding: string;
      foreign_keys: number;
      busy_timeout: number;
    };
    load_stats: { m5: number; m15: number; h1: number };
  };
  hooks: { installed: boolean; path: string; hooks: Record<string, boolean> };
  server: {
    uptime: number;
    node_version: string;
    platform: string;
    ws_connections: number;
    memory: { rss: number; heapTotal: number; heapUsed: number; external: number };
    cpu_load: number[];
    arch: string;
    total_mem: number;
    free_mem: number;
    cpus: number;
  };
  transcript_cache: {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    keys: string[];
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function SystemHealthTab() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowData | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [infoRes, workflowRes] = await Promise.all([
        api.settings.info(),
        api.workflows.get(),
      ]);
      setInfo(infoRes as any);
      setWorkflow(workflowRes);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadData();
    const int = setInterval(loadData, 30000);
    return () => clearInterval(int);
  }, [loadData]);

  const stats = useMemo(() => {
    if (!info || !workflow) return null;

    const totalEntries =
      (info.db.counts?.sessions || 0) +
      (info.db.counts?.agents || 0) +
      (info.db.counts?.events || 0);
    const sessPct = totalEntries > 0 ? ((info.db.counts?.sessions || 0) / totalEntries) * 100 : 0;
    const agentPct = totalEntries > 0 ? ((info.db.counts?.agents || 0) / totalEntries) * 100 : 0;
    const eventPct = totalEntries > 0 ? ((info.db.counts?.events || 0) / totalEntries) * 100 : 0;

    const modelStats = (workflow.modelDelegation?.tokensByModel || [])
      .sort((a, b) => b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens))
      .slice(0, 6);
    const totalTokens = modelStats.reduce((sum, m) => sum + m.input_tokens + m.output_tokens, 0);

    const memUsedPct =
      info.server.total_mem > 0 ? (1 - info.server.free_mem / info.server.total_mem) * 100 : 0;
    const heapUsedPct =
      info.server.memory.heapTotal > 0
        ? (info.server.memory.heapUsed / info.server.memory.heapTotal) * 100
        : 0;

    return {
      totalEntries,
      sessPct,
      agentPct,
      eventPct,
      modelStats,
      totalTokens,
      memUsedPct,
      heapUsedPct,
    };
  }, [info, workflow]);

  if (!info || !workflow || !stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="animate-pulse h-48 bg-surface-2 rounded-2xl" />
        ))}
      </div>
    );
  }

  const {
    totalEntries,
    sessPct,
    agentPct,
    eventPct,
    modelStats,
    totalTokens,
    memUsedPct,
    heapUsedPct,
  } = stats;
  const successRate = Math.max(0, Math.min(100, workflow.stats.successRate));
  const errorRate = Math.max(
    0,
    Math.min(100, workflow.errorPropagation?.errorRate ?? 100 - successRate)
  );
  const cacheHitRate = Math.max(
    0,
    Math.min(
      100,
      ((info.transcript_cache?.hits ?? 0) /
        ((info.transcript_cache?.hits ?? 0) + (info.transcript_cache?.misses ?? 0) || 1)) *
        100
    )
  );

  const lanes = workflow.concurrency?.aggregateLanes || [];
  const maxLaneCount = Math.max(...lanes.map((l) => l.count), 1);

  const topTools = (workflow.toolFlow?.toolCounts || []).slice(0, 8);
  const maxToolCount = topTools.length > 0 ? (topTools[0]?.count ?? 1) : 1;

  const effectiveness = (workflow.effectiveness || []).slice(0, 6);

  const healthScore = Math.max(
    0,
    Math.min(
      100,
      successRate * 0.4 +
        cacheHitRate * 0.25 +
        Math.max(0, 100 - errorRate) * 0.25 +
        Math.max(0, 100 - Math.min(100, heapUsedPct)) * 0.1
    )
  );

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Server className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-gray-500 uppercase tracking-wider">Runtime</span>
            </div>
            <span className="text-[10px] font-mono text-gray-500">
              {info.server.cpus} cores · {info.server.arch}
            </span>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-28 flex-shrink-0">Uptime</span>
              <span className="text-xs text-gray-200 font-mono ml-auto">
                {formatUptime(info.server.uptime)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-28 flex-shrink-0">CPU (1/5/15m)</span>
              <div className="flex gap-1 ml-auto">
                {(info.server.cpu_load || []).slice(0, 3).map((load, i) => (
                  <span
                    key={i}
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${i === 0 && load > info.server.cpus ? "bg-red-500/20 text-red-400" : "bg-surface-3 text-gray-300"}`}
                  >
                    {load.toFixed(2)}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-28 flex-shrink-0">Node RSS</span>
              <span className="text-xs text-gray-200 font-mono ml-auto">
                {formatBytes(info.server.memory.rss)}
              </span>
            </div>
          </div>

          <div className="border-t border-border/40 pt-3 space-y-3">
            <Tip
              block
              raw={`Host Memory: ${memUsedPct.toFixed(1)}% used\n${formatBytes(info.server.total_mem - info.server.free_mem)} / ${formatBytes(info.server.total_mem)}`}
            >
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Host Memory</span>
                  <span className="text-gray-400 font-mono">{memUsedPct.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-surface-3 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-700 ${memUsedPct > 90 ? "bg-red-500" : memUsedPct > 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${memUsedPct}%` }}
                  />
                </div>
              </div>
            </Tip>
            <Tip
              block
              raw={`V8 Heap: ${heapUsedPct.toFixed(1)}% used\n${formatBytes(info.server.memory.heapUsed)} / ${formatBytes(info.server.memory.heapTotal)}\nExternal: ${formatBytes(info.server.memory.external)}`}
            >
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">V8 Heap</span>
                  <span className="text-gray-400 font-mono">{heapUsedPct.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-surface-3 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-700 ${heapUsedPct > 85 ? "bg-red-500" : heapUsedPct > 60 ? "bg-amber-500" : "bg-blue-500"}`}
                    style={{ width: `${heapUsedPct}%` }}
                  />
                </div>
              </div>
            </Tip>
          </div>
        </div>

        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Database className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-gray-500 uppercase tracking-wider">Storage</span>
            </div>
            <Tip
              raw={`Write velocity (events):\n5 min: ${info.db.load_stats?.m5 ?? 0}\n15 min: ${info.db.load_stats?.m15 ?? 0}\n1 hr: ${info.db.load_stats?.h1 ?? 0}`}
            >
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10 cursor-default">
                ⚡ {info.db.load_stats?.m5 ?? 0}/{info.db.load_stats?.m15 ?? 0}/
                {info.db.load_stats?.h1 ?? 0}
              </span>
            </Tip>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 w-28 flex-shrink-0">Database</span>
            <span className="text-xs text-gray-200 font-mono ml-auto">
              {formatBytes(info.db.size)} · {info.db.pragmas?.journal_mode?.toUpperCase() || "WAL"}
            </span>
          </div>

          <div className="flex items-center justify-center gap-5 flex-1">
            <Tip
              raw={`Record Distribution\n\nSessions: ${(info.db.counts?.sessions ?? 0).toLocaleString()} (${sessPct.toFixed(1)}%)\nAgents: ${(info.db.counts?.agents ?? 0).toLocaleString()} (${agentPct.toFixed(1)}%)\nEvents: ${(info.db.counts?.events ?? 0).toLocaleString()} (${eventPct.toFixed(1)}%)\n\nTotal: ${totalEntries.toLocaleString()} records`}
            >
              <svg
                width={96}
                height={96}
                viewBox="0 0 96 96"
                className="flex-shrink-0 cursor-default"
              >
                <circle cx="48" cy="48" r="38" fill="none" stroke="#1e1e2e" strokeWidth="14" />
                {(() => {
                  const r = 38,
                    cx = 48,
                    cy = 48,
                    circumference = 2 * Math.PI * r;
                  const segments = [
                    { pct: sessPct, color: "#60a5fa" },
                    { pct: agentPct, color: "#8b5cf6" },
                    { pct: eventPct, color: "#34d399" },
                  ];
                  let offset = circumference / 4;
                  return segments.map((seg, i) => {
                    if (seg.pct <= 0) return null;
                    const dash = (seg.pct / 100) * circumference;
                    const gap = circumference - dash;
                    const currentOffset = offset;
                    offset -= dash;
                    return (
                      <circle
                        key={i}
                        cx={cx}
                        cy={cy}
                        r={r}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="14"
                        strokeDasharray={`${dash} ${gap}`}
                        strokeDashoffset={currentOffset}
                      />
                    );
                  });
                })()}
                <text
                  x="48"
                  y="46"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-gray-300"
                  fontSize="12"
                  fontWeight="700"
                  fontFamily="monospace"
                >
                  {totalEntries > 999 ? `${(totalEntries / 1000).toFixed(1)}K` : totalEntries}
                </text>
                <text
                  x="48"
                  y="60"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-gray-600"
                  fontSize="8"
                >
                  total
                </text>
              </svg>
            </Tip>
            <div className="space-y-2.5">
              {[
                {
                  label: "Sessions",
                  value: info.db.counts?.sessions ?? 0,
                  color: "#60a5fa",
                  pct: sessPct,
                },
                {
                  label: "Agents",
                  value: info.db.counts?.agents ?? 0,
                  color: "#8b5cf6",
                  pct: agentPct,
                },
                {
                  label: "Events",
                  value: info.db.counts?.events ?? 0,
                  color: "#34d399",
                  pct: eventPct,
                },
              ].map((item) => (
                <Tip
                  block
                  key={item.label}
                  raw={`${item.label}: ${item.value.toLocaleString()} (${item.pct.toFixed(1)}%)`}
                >
                  <div className="flex items-center gap-2 text-xs cursor-default">
                    <span
                      className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-gray-400">{item.label}</span>
                    <span className="text-gray-500 ml-auto pl-3 font-mono">
                      {Math.round(item.pct)}%
                    </span>
                  </div>
                </Tip>
              ))}
            </div>
          </div>
        </div>

        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-gray-500 uppercase tracking-wider">Health Score</span>
            </div>
            <Tip
              raw={`Composite Index formula:\n0.4 × Success Rate (${successRate.toFixed(1)}%)\n+ 0.25 × Cache Hit (${cacheHitRate.toFixed(1)}%)\n+ 0.25 × (100 − Error Rate) (${(100 - errorRate).toFixed(1)}%)\n+ 0.10 × (100 − Heap%) (${(100 - heapUsedPct).toFixed(1)}%)\n= ${healthScore.toFixed(1)}`}
            >
              <span className="text-[10px] text-gray-500 cursor-help border-b border-dashed border-gray-700">
                ⓘ Formula
              </span>
            </Tip>
          </div>

          <div className="flex items-center justify-center flex-1">
            <Tip
              raw={`Score: ${healthScore.toFixed(1)} / 100\n\n• Success Rate (40%): ${successRate.toFixed(1)}%\n• Cache Hit (25%): ${cacheHitRate.toFixed(1)}%\n• Error Avoidance (25%): ${(100 - errorRate).toFixed(1)}%\n• Memory Health (10%): ${(100 - heapUsedPct).toFixed(1)}%`}
            >
              <svg width="120" height="120" viewBox="0 0 120 120" className="cursor-default">
                <circle cx="60" cy="60" r="48" fill="none" stroke="#1e1e2e" strokeWidth="10" />
                <circle
                  cx="60"
                  cy="60"
                  r="48"
                  fill="none"
                  stroke={healthScore >= 90 ? "#34d399" : healthScore >= 70 ? "#fbbf24" : "#f87171"}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${healthScore * 3.016} ${301.6 - healthScore * 3.016}`}
                  strokeDashoffset={301.6 / 4}
                  className="transition-all duration-1000"
                />
                <text
                  x="60"
                  y="57"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-gray-100"
                  fontSize="24"
                  fontWeight="800"
                  fontFamily="monospace"
                >
                  {healthScore.toFixed(0)}
                </text>
                <text
                  x="60"
                  y="76"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-gray-600"
                  fontSize="9"
                  fontWeight="500"
                >
                  / 100
                </text>
              </svg>
            </Tip>
          </div>

          <div className="grid grid-cols-4 gap-2 border-t border-border/40 pt-3">
            <Tip
              block
              raw={`Cache Hit Rate: ${cacheHitRate.toFixed(1)}%\nHits: ${info.transcript_cache?.hits ?? 0}\nMisses: ${info.transcript_cache?.misses ?? 0}`}
            >
              <div className="text-center cursor-default">
                <p className="text-[9px] text-gray-600 uppercase">Cache</p>
                <p className="text-xs font-mono font-bold text-blue-400">
                  {cacheHitRate.toFixed(0)}%
                </p>
              </div>
            </Tip>
            <Tip
              block
              raw={`Error Rate: ${errorRate.toFixed(2)}%\n<5% = healthy, 5-15% = warning, >15% = critical`}
            >
              <div className="text-center cursor-default">
                <p className="text-[9px] text-gray-600 uppercase">Errors</p>
                <p
                  className={`text-xs font-mono font-bold ${errorRate < 5 ? "text-emerald-400" : errorRate < 15 ? "text-amber-400" : "text-red-400"}`}
                >
                  {errorRate.toFixed(1)}%
                </p>
              </div>
            </Tip>
            <Tip
              block
              raw={`Transcript compactions: ${workflow.compaction?.totalCompactions ?? 0}\nReduces context window by summarizing turns.`}
            >
              <div className="text-center cursor-default">
                <p className="text-[9px] text-gray-600 uppercase">Compact</p>
                <p className="text-xs font-mono font-bold text-violet-400">
                  {workflow.compaction?.totalCompactions ?? 0}
                </p>
              </div>
            </Tip>
            <Tip
              block
              raw={`Tokens recovered: ${(workflow.compaction?.tokensRecovered ?? 0).toLocaleString()}\nFreed by compaction.`}
            >
              <div className="text-center cursor-default">
                <p className="text-[9px] text-gray-600 uppercase">Saved</p>
                <p className="text-xs font-mono font-bold text-emerald-400">
                  {((workflow.compaction?.tokensRecovered ?? 0) / 1000).toFixed(1)}K
                </p>
              </div>
            </Tip>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bot className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-gray-500 uppercase tracking-wider">Token Usage</span>
            </div>
            <span className="text-[10px] font-mono text-gray-500">
              {(totalTokens / 1000).toFixed(1)}K total
            </span>
          </div>

          <div className="space-y-2.5">
            {modelStats.map((m, i) => {
              const pct =
                totalTokens > 0 ? ((m.input_tokens + m.output_tokens) / totalTokens) * 100 : 0;
              const colors = [
                "bg-blue-400",
                "bg-violet-400",
                "bg-emerald-400",
                "bg-amber-400",
                "bg-pink-400",
                "bg-cyan-400",
              ];
              return (
                <Tip
                  block
                  key={i}
                  raw={`${formatModelName(m.model) ?? m.model}\nInput: ${m.input_tokens.toLocaleString()}\nOutput: ${m.output_tokens.toLocaleString()}\nCache Read: ${m.cache_read_tokens.toLocaleString()}\nShare: ${pct.toFixed(1)}%`}
                >
                  <div className="flex items-center gap-3 cursor-default">
                    <span
                      className="text-xs text-gray-400 w-28 truncate flex-shrink-0"
                      title={formatModelName(m.model) ?? m.model}
                    >
                      {formatModelName(m.model) ?? m.model}
                    </span>
                    <div className="flex-1 bg-surface-3 rounded-full h-2">
                      <div
                        className={`${colors[i % colors.length]} h-2 rounded-full transition-all duration-700`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-12 text-right flex-shrink-0 font-mono">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </Tip>
              );
            })}
            {modelStats.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-4">No model data</p>
            )}
          </div>
        </div>

        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BarChart3 className="w-4 h-4 text-violet-400" />
              <span className="text-xs text-gray-500 uppercase tracking-wider">Concurrency</span>
            </div>
            <span className="text-[10px] font-mono text-gray-500">{lanes.length} intervals</span>
          </div>

          <Tip
            block
            raw={`Peak: ${maxLaneCount} parallel sessions\nActive intervals: ${lanes.filter((l) => l.count > 0).length}\nAvg: ${lanes.length > 0 ? (lanes.reduce((s, l) => s + l.count, 0) / lanes.length).toFixed(1) : "0"}`}
          >
            <div className="flex items-end gap-px h-20 cursor-default">
              {lanes.slice(-Math.min(lanes.length, 40)).map((lane, i) => {
                const barPct =
                  maxLaneCount > 0 ? Math.max(4, Math.round((lane.count / maxLaneCount) * 100)) : 4;
                const color =
                  lane.count > 5
                    ? "#f87171"
                    : lane.count > 2
                      ? "#fbbf24"
                      : lane.count > 0
                        ? "#34d399"
                        : "#1e1e2e";
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-sm transition-all"
                    style={{
                      height: `${barPct}%`,
                      backgroundColor: color,
                      opacity: lane.count === 0 ? 0.2 : 0.85,
                    }}
                  />
                );
              })}
              {lanes.length === 0 && (
                <p className="text-xs text-gray-600 text-center w-full self-center">
                  No concurrency data
                </p>
              )}
            </div>
          </Tip>

          <div className="grid grid-cols-3 gap-3 border-t border-border/40 pt-3">
            <Tip block raw={`Peak: ${maxLaneCount} sessions running simultaneously.`}>
              <div className="text-center cursor-default">
                <p className="text-[9px] text-gray-600 uppercase">Peak</p>
                <p className="text-sm font-mono font-bold text-gray-200">{maxLaneCount}</p>
              </div>
            </Tip>
            <Tip
              block
              raw={`${lanes.filter((l) => l.count > 0).length} of ${lanes.length} intervals have active sessions.`}
            >
              <div className="text-center cursor-default">
                <p className="text-[9px] text-gray-600 uppercase">Active</p>
                <p className="text-sm font-mono font-bold text-emerald-400">
                  {lanes.filter((l) => l.count > 0).length}
                </p>
              </div>
            </Tip>
            <Tip block raw={`Average concurrency across all intervals.`}>
              <div className="text-center cursor-default">
                <p className="text-[9px] text-gray-600 uppercase">Avg</p>
                <p className="text-sm font-mono font-bold text-blue-400">
                  {lanes.length > 0
                    ? (lanes.reduce((s, l) => s + l.count, 0) / lanes.length).toFixed(1)
                    : "0"}
                </p>
              </div>
            </Tip>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-gray-500 uppercase tracking-wider">Tool Usage</span>
            </div>
            <span className="text-[10px] font-mono text-gray-500">top {topTools.length}</span>
          </div>

          <div className="space-y-2">
            {topTools.map((tool, i) => {
              const pct = maxToolCount > 0 ? Math.round((tool.count / maxToolCount) * 100) : 0;
              const colors = [
                "bg-amber-400",
                "bg-blue-400",
                "bg-emerald-400",
                "bg-violet-400",
                "bg-pink-400",
                "bg-cyan-400",
                "bg-red-400",
                "bg-indigo-400",
              ];
              return (
                <Tip
                  block
                  key={i}
                  raw={`${tool.tool_name}: ${tool.count.toLocaleString()} invocations`}
                >
                  <div className="flex items-center gap-3 cursor-default">
                    <span
                      className="text-xs text-gray-400 w-28 truncate flex-shrink-0"
                      title={tool.tool_name}
                    >
                      {tool.tool_name}
                    </span>
                    <div className="flex-1 bg-surface-3 rounded-full h-2">
                      <div
                        className={`${colors[i % colors.length]} h-2 rounded-full transition-all duration-500`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-10 text-right flex-shrink-0 font-mono">
                      {tool.count > 999 ? `${(tool.count / 1000).toFixed(1)}K` : tool.count}
                    </span>
                  </div>
                </Tip>
              );
            })}
            {topTools.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-6">No tool data yet</p>
            )}
          </div>
        </div>

        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GitBranch className="w-4 h-4 text-violet-400" />
              <span className="text-xs text-gray-500 uppercase tracking-wider">
                Subagent Effectiveness
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {effectiveness.map((item, i) => {
              const color =
                item.successRate >= 90
                  ? "bg-emerald-400"
                  : item.successRate >= 70
                    ? "bg-amber-400"
                    : "bg-red-400";
              return (
                <Tip
                  block
                  key={i}
                  raw={`${item.subagent_type || "default"}\nSuccess: ${item.successRate.toFixed(1)}%\nTotal: ${item.total} · OK: ${item.completed} · Errors: ${item.errors}`}
                >
                  <div className="flex items-center gap-3 cursor-default">
                    <span className="text-xs text-gray-400 w-28 truncate flex-shrink-0">
                      {item.subagent_type || "default"}
                    </span>
                    <div className="flex-1 bg-surface-3 rounded-full h-2">
                      <div
                        className={`${color} h-2 rounded-full transition-all duration-500`}
                        style={{ width: `${item.successRate}%` }}
                      />
                    </div>
                    <span
                      className={`text-xs w-12 text-right flex-shrink-0 font-mono ${item.successRate >= 90 ? "text-emerald-400" : item.successRate >= 70 ? "text-amber-400" : "text-red-400"}`}
                    >
                      {item.successRate.toFixed(0)}%
                    </span>
                  </div>
                </Tip>
              );
            })}
            {effectiveness.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-6">No subagent data yet</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Plug className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-gray-500 uppercase tracking-wider">Integration</span>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded ${info.hooks.installed ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-surface-3 text-gray-500 border border-border"}`}
            >
              {info.hooks.installed ? "Active" : "Offline"}
            </span>
          </div>

          {Object.entries(info.hooks.hooks || {}).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(info.hooks.hooks).map(([cwd, active]) => (
                <Tip
                  block
                  key={cwd}
                  raw={`Path: ${cwd}\nStatus: ${active ? "Connected" : "Disconnected"}`}
                >
                  <div className="flex items-center gap-3 bg-surface-2/50 px-3 py-2 rounded-lg border border-border/30 cursor-default">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? "bg-emerald-400" : "bg-gray-600"}`}
                    />
                    <span className="text-xs text-gray-300 truncate font-mono">
                      {cwd.split("/").pop() || cwd}
                    </span>
                  </div>
                </Tip>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 border border-dashed border-border/40 rounded-lg">
              <Search className="w-4 h-4 text-gray-600 mb-2" />
              <p className="text-xs text-gray-500">No project hooks registered</p>
            </div>
          )}

          <Tip
            block
            raw={`WebSocket connections: ${info.server.ws_connections}\nProtocol: RFC 6455`}
          >
            <div className="flex items-center gap-3 bg-emerald-500/5 px-3 py-2.5 rounded-lg border border-emerald-500/10 cursor-default">
              <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <div>
                <p className="text-[10px] text-emerald-400 font-medium">WebSocket Active</p>
                <p className="text-[10px] text-gray-500">
                  {info.server.ws_connections} connection
                  {info.server.ws_connections !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          </Tip>
        </div>

        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span className="text-xs text-gray-500 uppercase tracking-wider">Platform</span>
            </div>
            <span className="text-[10px] font-mono text-gray-500">{info.server.node_version}</span>
          </div>

          <div className="space-y-2">
            {[
              {
                label: "Journal Mode",
                value: info.db.pragmas?.journal_mode?.toUpperCase() || "WAL",
              },
              {
                label: "Synchronous",
                value:
                  info.db.pragmas?.synchronous === 2
                    ? "FULL"
                    : info.db.pragmas?.synchronous === 1
                      ? "NORMAL"
                      : "OFF",
              },
              { label: "Auto-Vacuum", value: info.db.pragmas?.auto_vacuum > 0 ? "FULL" : "OFF" },
              { label: "Foreign Keys", value: info.db.pragmas?.foreign_keys ? "ON" : "OFF" },
              { label: "Busy Timeout", value: `${info.db.pragmas?.busy_timeout || 5000}ms` },
              { label: "Platform", value: `${info.server.platform} / ${info.server.arch}` },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-28 flex-shrink-0">{row.label}</span>
                <span className="text-xs text-gray-200 font-mono ml-auto">{row.value}</span>
              </div>
            ))}
          </div>

          <Tip block raw={info.db.path}>
            <div className="flex items-center gap-2 bg-surface-2/50 px-3 py-2 rounded-lg border border-border/30 cursor-default">
              <HardDrive className="w-3 h-3 text-gray-500 flex-shrink-0" />
              <span className="text-[10px] text-gray-400 font-mono truncate">{info.db.path}</span>
            </div>
          </Tip>
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function Dashboard() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("dashboard");
  const locale = i18n.resolvedLanguage ?? i18n.language;

  const [activeTab, setActiveTab] = useState<"monitor" | "health">(() => {
    return (localStorage.getItem("dashboard_tab") as "monitor" | "health") || "monitor";
  });

  useEffect(() => {
    localStorage.setItem("dashboard_tab", activeTab);
  }, [activeTab]);

  const [analyticsTab, setAnalyticsTab] = useState<
    "cost" | "tokens" | "productivity" | "workflow"
  >("cost");

  // Active-agents + headline stats (carried over from upstream Dashboard).
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeAgents, setActiveAgents] = useState<Agent[]>([]);
  const [allSubagents, setAllSubagents] = useState<Agent[]>([]);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Analytics data (merged in from the upstream Analytics page).
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [costData, setCostData] = useState<CostResult | null>(null);

  const agentsContainerRef = useRef<HTMLDivElement>(null);
  const [visibleAgentCount, setVisibleAgentCount] = useState(5);

  useEffect(() => {
    const AGENT_ROW_H = 56;
    const HEADER_H = 40;

    function recalc() {
      if (agentsContainerRef.current) {
        const h = agentsContainerRef.current.clientHeight;
        setVisibleAgentCount(Math.max(3, Math.floor((h - HEADER_H) / AGENT_ROW_H)));
      }
    }

    const ro = new ResizeObserver(recalc);
    if (agentsContainerRef.current) ro.observe(agentsContainerRef.current);
    recalc();

    return () => ro.disconnect();
  }, [activeTab]);

  const load = useCallback(async () => {
    try {
      const [statsRes, workingRes, waitingRes, costRes, analyticsRes] = await Promise.all([
        api.stats.get(),
        api.agents.list({ status: "working", limit: 20 }),
        api.agents.list({ status: "waiting", limit: 20 }),
        api.pricing.totalCost().catch(() => null),
        api.analytics.get().catch(() => null),
      ]);
      setStats(statsRes);
      const active = [...workingRes.agents, ...waitingRes.agents];
      setActiveAgents(active);
      setCostData(costRes);
      setAnalyticsData(analyticsRes);
      setError(null);

      const activeSessionIds = [
        ...new Set(active.filter((a) => a.type === "main").map((a) => a.session_id)),
      ];
      const subagentResults = await Promise.all(
        activeSessionIds.map((sid) => api.agents.list({ session_id: sid, limit: 100 }))
      );
      const subs = subagentResults.flatMap((r) => r.agents).filter((a) => a.type === "subagent");
      setAllSubagents(subs);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedLoad"));
    }
  }, [t]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const parentsWithActive = new Set<string>();
    for (const a of allSubagents) {
      if (a.parent_agent_id && a.status === "working") {
        parentsWithActive.add(a.parent_agent_id);
      }
    }
    if (parentsWithActive.size === 0) return;

    const subMap = new Map(allSubagents.map((a) => [a.id, a]));
    const toExpand = new Set<string>();
    for (const pid of parentsWithActive) {
      let cur = pid;
      while (cur) {
        toExpand.add(cur);
        const parent = subMap.get(cur);
        cur = parent?.parent_agent_id ?? "";
      }
    }
    setExpandedAgents((prev) => {
      const newIds = [...toExpand].filter((id) => !prev.has(id));
      if (newIds.length === 0) return prev;
      return new Set([...prev, ...newIds]);
    });
  }, [allSubagents]);

  useEffect(() => {
    const debounceRef = { timer: null as ReturnType<typeof setTimeout> | null };
    return eventBus.subscribe((msg: WSMessage) => {
      if (
        msg.type === "agent_created" ||
        msg.type === "agent_updated" ||
        msg.type === "session_created" ||
        msg.type === "session_updated" ||
        msg.type === "new_event"
      ) {
        if (debounceRef.timer) clearTimeout(debounceRef.timer);
        debounceRef.timer = setTimeout(load, 300);
      }
    });
  }, [load]);

  const wsConnected = useSyncExternalStore(eventBus.onConnection, () => eventBus.connected);

  const agentTree = useMemo(() => {
    const childrenByParent = new Map<string, Agent[]>();
    for (const a of allSubagents) {
      if (a.parent_agent_id) {
        const list = childrenByParent.get(a.parent_agent_id) || [];
        list.push(a);
        childrenByParent.set(a.parent_agent_id, list);
      }
    }

    const descendantCache = new Map<string, { total: number; active: number }>();
    function getDescendants(id: string): { total: number; active: number } {
      if (descendantCache.has(id)) return descendantCache.get(id)!;
      const kids = childrenByParent.get(id) || [];
      const result = kids.reduce(
        (acc, k) => {
          const child = getDescendants(k.id);
          return {
            total: acc.total + 1 + child.total,
            active: acc.active + (k.status === "working" ? 1 : 0) + child.active,
          };
        },
        { total: 0, active: 0 }
      );
      descendantCache.set(id, result);
      return result;
    }
    for (const a of allSubagents) getDescendants(a.id);

    return { childrenByParent, getDescendants };
  }, [allSubagents]);

  // ── Analytics-derived data ────────────────────────────────────────────────

  const dailyMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of analyticsData?.daily_events ?? []) {
      m[d.date] = (m[d.date] ?? 0) + d.count;
    }
    return m;
  }, [analyticsData]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }, []);

  const weeks = useMemo(() => {
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 364);
    const startDow = startDate.getDay();
    startDate.setDate(startDate.getDate() - startDow);

    const result: Array<Array<{ date: string; count: number }>> = [];
    for (let w = 0; w < 53; w++) {
      const week: Array<{ date: string; count: number }> = [];
      for (let d = 0; d < 7; d++) {
        const cell = new Date(startDate);
        cell.setDate(startDate.getDate() + w * 7 + d);
        if (cell > today) break;
        const dateStr = localDateStr(cell);
        week.push({ date: dateStr, count: dailyMap[dateStr] ?? 0 });
      }
      if (week.length > 0) result.push(week);
    }
    return result;
  }, [today, dailyMap]);

  const last30 = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() - (29 - i));
        const dateStr = localDateStr(d);
        return { date: dateStr, count: dailyMap[dateStr] ?? 0 };
      }),
    [today, dailyMap]
  );

  const dailySessionsLocal = useMemo(() => {
    const result: Array<{ date: string; count: number }> = [];
    const sessMap: Record<string, number> = {};
    for (const d of analyticsData?.daily_sessions ?? []) {
      sessMap[d.date] = (sessMap[d.date] ?? 0) + d.count;
    }
    for (const [date, count] of Object.entries(sessMap)) {
      result.push({ date, count });
    }
    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }, [analyticsData]);

  const costMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of costData?.daily_costs ?? []) {
      m[d.date] = (m[d.date] ?? 0) + d.cost;
    }
    return m;
  }, [costData]);

  const dailyCostLast30 = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() - (29 - i));
        const dateStr = localDateStr(d);
        return { date: dateStr, cost: costMap[dateStr] ?? 0 };
      }),
    [today, costMap]
  );

  const peakCostDay = dailyCostLast30.reduce(
    (max, curr) => (curr.cost > max.cost ? curr : max),
    dailyCostLast30[0] ?? { date: "", cost: 0 }
  );
  const totalCost30d = dailyCostLast30.reduce((sum, day) => sum + day.cost, 0);
  const costBreakdown = [...(costData?.breakdown ?? [])]
    .filter((b) => b.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  const weekdayCosts = useMemo(() => {
    const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
    return weekdayOrder.map((dow) => {
      const label = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
        new Date(Date.UTC(2026, 0, 4 + dow))
      );
      const cost = dailyCostLast30
        .filter((day) => new Date(day.date + "T12:00:00").getDay() === dow)
        .reduce((sum, day) => sum + day.cost, 0);
      return { label, cost };
    });
  }, [locale, dailyCostLast30]);
  const maxWeekdayCost = Math.max(...weekdayCosts.map((d) => d.cost), 1);

  const totalTokens =
    (analyticsData?.tokens.total_input ?? 0) +
    (analyticsData?.tokens.total_output ?? 0) +
    (analyticsData?.tokens.total_cache_read ?? 0) +
    (analyticsData?.tokens.total_cache_write ?? 0);

  const tokenMixSegments = [
    { label: "Input", value: analyticsData?.tokens.total_input ?? 0, color: "#60a5fa" },
    { label: "Output", value: analyticsData?.tokens.total_output ?? 0, color: "#34d399" },
    { label: "Cache Read", value: analyticsData?.tokens.total_cache_read ?? 0, color: "#a78bfa" },
    {
      label: "Cache Write",
      value: analyticsData?.tokens.total_cache_write ?? 0,
      color: "#facc15",
    },
  ].filter((s) => s.value > 0);

  const maxToolCount = analyticsData?.tool_usage[0]?.count ?? 1;
  const maxAgentTypeCount = analyticsData?.agent_types[0]?.count ?? 1;
  const maxEventTypeCount = analyticsData?.event_types[0]?.count ?? 1;

  const cacheHitPct =
    totalTokens > 0
      ? Math.round(((analyticsData?.tokens.total_cache_read ?? 0) / totalTokens) * 100)
      : 0;

  const sessionOutcomeSegments = [
    { label: "Completed", value: analyticsData?.sessions_by_status?.completed ?? 0, color: "#8b5cf6" },
    { label: "Active", value: analyticsData?.sessions_by_status?.active ?? 0, color: "#10b981" },
    { label: "Error", value: analyticsData?.sessions_by_status?.error ?? 0, color: "#ef4444" },
    {
      label: "Abandoned",
      value: analyticsData?.sessions_by_status?.abandoned ?? 0,
      color: "#f59e0b",
    },
  ].filter((s) => s.value > 0);

  const agentStatusSegments = [
    { label: "Completed", value: analyticsData?.agents_by_status?.completed ?? 0, color: "#8b5cf6" },
    { label: "Working", value: analyticsData?.agents_by_status?.working ?? 0, color: "#10b981" },
    { label: "Waiting", value: analyticsData?.agents_by_status?.waiting ?? 0, color: "#eab308" },
    { label: "Error", value: analyticsData?.agents_by_status?.error ?? 0, color: "#ef4444" },
  ].filter((s) => s.value > 0);

  const EVENT_TYPE_COLORS: Record<string, string> = {
    PreToolUse: "bg-emerald-400",
    PostToolUse: "bg-blue-400",
    Stop: "bg-violet-400",
    SubagentStop: "bg-yellow-400",
    Notification: "bg-orange-400",
  };

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 mb-2">{t("failedConnect")}</p>
        <p className="text-sm text-gray-500">{error}</p>
        <button onClick={load} className="btn-primary mt-4">
          {t("common:retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 animate-fade-in min-h-[calc(100vh-4rem)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
            <LayoutDashboard className="w-4.5 h-4.5 text-accent" />
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
            <p className="text-xs text-gray-500">{t("subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-surface-2 rounded-lg p-0.5 border border-border">
            <button
              onClick={() => setActiveTab("monitor")}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${
                activeTab === "monitor"
                  ? "bg-accent/15 text-accent shadow-sm"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              <Activity className="w-3.5 h-3.5" /> Monitor
            </button>
            <button
              onClick={() => setActiveTab("health")}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${
                activeTab === "health"
                  ? "bg-accent/15 text-accent shadow-sm"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              <Server className="w-3.5 h-3.5" /> Health
            </button>
          </div>
          <button onClick={load} className="btn-ghost flex-shrink-0">
            <RefreshCw className="w-4 h-4" /> {t("common:refresh")}
          </button>
        </div>
      </div>

      {activeTab === "monitor" ? (
        <div className="flex flex-col gap-8">
          {/* 5 stat pills */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatPill
              label="Total Sessions"
              value={fmt(analyticsData?.overview.total_sessions ?? stats?.total_sessions ?? 0)}
              raw={(
                analyticsData?.overview.total_sessions ??
                stats?.total_sessions ??
                0
              ).toLocaleString()}
              sub={`${analyticsData?.overview.active_sessions ?? stats?.active_sessions ?? 0} active`}
              icon={FolderOpen}
              color="text-blue-400"
              testid="audit-dashboard-monitor-total-sessions"
              subTestid="audit-dashboard-monitor-total-sessions-trend-active"
            />
            <StatPill
              label="Total Agents"
              value={fmt(analyticsData?.overview.total_agents ?? 0)}
              raw={(analyticsData?.overview.total_agents ?? 0).toLocaleString()}
              sub={`${analyticsData?.overview.active_agents ?? stats?.active_agents ?? 0} active`}
              icon={Bot}
              color="text-emerald-400"
              subTestid="audit-dashboard-monitor-active-agents"
            />
            <StatPill
              label="Total Tokens"
              value={fmt(totalTokens)}
              raw={totalTokens.toLocaleString()}
              sub={`${cacheHitPct}% cache hit rate`}
              icon={Cpu}
              color="text-violet-400"
            />
            <StatPill
              label="Total Cost"
              value={costData ? fmtCost(costData.total_cost) : "$0.00"}
              raw={costData ? fmtCostFull(costData.total_cost) : undefined}
              sub={
                costData
                  ? `${costData.breakdown.length} model${costData.breakdown.length === 1 ? "" : "s"}`
                  : "No cost data yet"
              }
              icon={DollarSign}
              color="text-emerald-400"
              testid="audit-dashboard-monitor-total-cost"
            />
            <StatPill
              label="Total Events"
              value={fmt(analyticsData?.overview.total_events ?? stats?.total_events ?? 0)}
              raw={(
                analyticsData?.overview.total_events ??
                stats?.total_events ??
                0
              ).toLocaleString()}
              sub={`~${analyticsData?.avg_events_per_session ?? 0} per session`}
              icon={Zap}
              color="text-yellow-400"
              testid="audit-dashboard-monitor-total-events"
            />
          </div>

          {/* Active Agents — full width, directly under the stat pills */}
          <div ref={agentsContainerRef} className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-300">{t("activeAgentsSection")}</h3>
              <button onClick={() => navigate("/kanban")} className="btn-ghost text-xs">
                {t("viewBoard")} <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            {activeAgents.length === 0 ? (
              <EmptyState icon={Bot} title={t("noAgents")} description={t("noAgentsDesc")} />
            ) : (
              <div className="space-y-2">
                {(() => {
                  const { childrenByParent, getDescendants } = agentTree;

                  function renderAgentNode(agent: Agent, depth: number) {
                    const children = childrenByParent.get(agent.id) || [];
                    const isExpanded = expandedAgents.has(agent.id);
                    const hasChildren = children.length > 0;
                    const isSubagent = depth > 0;
                    const { total: totalDesc, active: activeDesc } = hasChildren
                      ? getDescendants(agent.id)
                      : { total: 0, active: 0 };
                    const toggleExpanded = () =>
                      setExpandedAgents((prev) => {
                        const next = new Set(prev);
                        if (next.has(agent.id)) next.delete(agent.id);
                        else next.add(agent.id);
                        return next;
                      });

                    return (
                      <div key={agent.id}>
                        <div className="flex items-center gap-1 min-w-0">
                          {hasChildren && (
                            <button
                              onClick={toggleExpanded}
                              className="p-1 text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
                              aria-label={isExpanded ? "Collapse subagents" : "Expand subagents"}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>
                          )}
                          {!hasChildren && <span className="w-6 flex-shrink-0" />}
                          {isSubagent && (
                            <GitBranch className="w-3 h-3 text-violet-400 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <AgentCard
                              agent={agent}
                              onClick={hasChildren ? toggleExpanded : undefined}
                            />
                          </div>
                        </div>

                        {hasChildren && isExpanded && (
                          <div className="ml-6 mt-1 space-y-1 border-l-2 border-violet-500/20 pl-3">
                            {children.map((child) => renderAgentNode(child, depth + 1))}
                          </div>
                        )}

                        {hasChildren && !isExpanded && (
                          <button
                            onClick={() =>
                              setExpandedAgents((prev) => new Set([...prev, agent.id]))
                            }
                            className="ml-7 mt-1 text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
                          >
                            {totalDesc} {t("common:subagent", { count: totalDesc })}
                            {activeDesc > 0 && (
                              <span className="text-emerald-400 ml-1">
                                ({activeDesc} {t("common:active")})
                              </span>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  }

                  return (
                    <>
                      {activeAgents
                        .filter((a) => a.type === "main")
                        .slice(0, visibleAgentCount)
                        .map((main) => renderAgentNode(main, 0))}
                      {activeAgents
                        .filter((a) => a.type === "subagent")
                        .map((agent) => (
                          <div key={agent.id}>
                            <AgentCard agent={agent} />
                          </div>
                        ))}
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Event activity heatmap + Last 30 days sparkline */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="card p-5 lg:col-span-2">
              <h3 className="text-sm font-medium text-gray-300 mb-1">Event Activity</h3>
              <p className="text-[11px] text-gray-600 mb-4">Last 52 weeks · daily event counts</p>
              <div className="overflow-x-auto">
                <div className="w-fit min-w-max mx-auto">
                  <Heatmap weeks={weeks} locale={locale} />
                </div>
              </div>
            </div>
            <div className="card p-5">
              <h3 className="text-sm font-medium text-gray-300 mb-1">Last 30 Days</h3>
              <p className="text-[11px] text-gray-600 mb-4">Daily event count</p>
              <Sparkline data={last30} />
              <div className="flex justify-between text-[11px] text-gray-600 mt-2">
                <span>{last30[0]?.date?.slice(5)}</span>
                <span>{last30[last30.length - 1]?.date?.slice(5)}</span>
              </div>
              <div className="mt-4 pt-4 border-t border-border space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Peak day</span>
                  <span className="text-gray-300 font-mono">
                    <Tip raw={Math.max(...last30.map((d) => d.count)).toLocaleString()}>
                      {fmt(Math.max(...last30.map((d) => d.count)))}
                    </Tip>{" "}
                    events
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Total (30d)</span>
                  <span className="text-gray-300 font-mono">
                    <Tip raw={last30.reduce((s, d) => s + d.count, 0).toLocaleString()}>
                      {fmt(last30.reduce((s, d) => s + d.count, 0))}
                    </Tip>{" "}
                    events
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Inner analytics tabs */}
          <div>
            <div className="flex gap-1 bg-surface-2 rounded-lg p-1 mb-6 w-fit">
              {(
                [
                  { key: "cost" as const, label: "Cost Analytics" },
                  { key: "tokens" as const, label: "Token Analytics" },
                  { key: "productivity" as const, label: "Productivity Analytics" },
                  { key: "workflow" as const, label: "Workflow Intelligence" },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setAnalyticsTab(key)}
                  className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    analyticsTab === key
                      ? "bg-surface-4 text-gray-200"
                      : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {analyticsTab === "cost" && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="card p-5">
                  <h3 className="text-sm font-medium text-gray-300 mb-1">Daily Cost Trends</h3>
                  {Object.keys(costMap).length === 0 ? (
                    <p className="text-sm text-gray-500">No daily cost data yet</p>
                  ) : (
                    <>
                      <p className="text-[11px] text-gray-600 mb-4">Cost per day</p>
                      <CostTrendLine data={dailyCostLast30} />
                      <div className="flex justify-between text-[11px] text-gray-600 mt-2">
                        <span>{dailyCostLast30[0]?.date?.slice(5)}</span>
                        <span>
                          {dailyCostLast30[dailyCostLast30.length - 1]?.date?.slice(5)}
                        </span>
                      </div>
                      <div className="mt-4 pt-4 border-t border-border space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500">Peak cost day</span>
                          <span className="text-emerald-400 font-mono">
                            <Tip raw={`${peakCostDay.date} • ${fmtCostFull(peakCostDay.cost)}`}>
                              {fmtCost(peakCostDay.cost)}
                            </Tip>
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500">Total (30d)</span>
                          <span className="text-emerald-400 font-mono">
                            <Tip raw={fmtCostFull(totalCost30d)}>{fmtCost(totalCost30d)}</Tip>
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="card p-5">
                  <h3 className="text-sm font-medium text-gray-300 mb-5">Cost by Model</h3>
                  {costBreakdown.length > 0 ? (
                    <>
                      <DonutChart
                        segments={costBreakdown.map((b, i) => ({
                          label: formatModelName(b.model) ?? b.model,
                          value: Math.round(b.cost * 100),
                          color:
                            ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899"][
                              i % 6
                            ] ?? "#6b7280",
                        }))}
                        formatTotal={(cents) => fmtCost(cents / 100)}
                      />
                      <div className="mt-4 pt-4 border-t border-border space-y-2">
                        {costBreakdown.map((b) => (
                          <div key={b.model} className="flex justify-between text-xs">
                            <span className="text-gray-400 font-mono truncate">
                              {formatModelName(b.model)}
                            </span>
                            <span className="text-emerald-400 font-mono font-medium ml-2">
                              <Tip raw={fmtCostFull(b.cost)}>{fmtCost(b.cost)}</Tip>
                            </span>
                          </div>
                        ))}
                        <div className="flex justify-between text-xs pt-2 border-t border-border">
                          <span className="text-gray-300 font-medium">Total</span>
                          <span className="text-emerald-400 font-mono font-semibold">
                            <Tip raw={fmtCostFull(costData?.total_cost ?? 0)}>
                              {fmtCost(costData?.total_cost ?? 0)}
                            </Tip>
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">No cost data yet</p>
                  )}
                </div>

                <div className="card p-5">
                  <h3 className="text-sm font-medium text-gray-300 mb-1">Cost by Weekday</h3>
                  {Object.keys(costMap).length === 0 ? (
                    <p className="text-sm text-gray-500">No daily cost data yet</p>
                  ) : (
                    <>
                      <p className="text-[11px] text-gray-600 mb-4">Last 30 days</p>
                      <div className="space-y-3">
                        {weekdayCosts.map(({ label, cost }) => (
                          <CostBarRow
                            key={label}
                            label={label}
                            cost={cost}
                            max={maxWeekdayCost}
                            color="bg-cyan-400"
                          />
                        ))}
                      </div>
                      <div className="mt-4 pt-4 border-t border-border text-xs flex justify-between">
                        <span className="text-gray-500">Total</span>
                        <span className="text-cyan-400 font-mono">
                          <Tip raw={fmtCostFull(totalCost30d)}>{fmtCost(totalCost30d)}</Tip>
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {analyticsTab === "tokens" && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="card p-5">
                  <h3 className="text-sm font-medium text-gray-300 mb-5">Token Distribution</h3>
                  <div className="space-y-4">
                    {[
                      {
                        label: "Input",
                        value: analyticsData?.tokens.total_input ?? 0,
                        color: "bg-blue-400",
                      },
                      {
                        label: "Output",
                        value: analyticsData?.tokens.total_output ?? 0,
                        color: "bg-emerald-400",
                      },
                      {
                        label: "Cache Read",
                        value: analyticsData?.tokens.total_cache_read ?? 0,
                        color: "bg-violet-400",
                      },
                      {
                        label: "Cache Write",
                        value: analyticsData?.tokens.total_cache_write ?? 0,
                        color: "bg-yellow-400",
                      },
                    ].map(({ label, value, color }) => (
                      <BarRow
                        key={label}
                        label={label}
                        count={value}
                        max={Math.max(totalTokens, 1)}
                        color={color}
                      />
                    ))}
                  </div>
                  <div className="mt-6 pt-4 border-t border-border space-y-1.5">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Total tokens</span>
                      <Tip raw={totalTokens.toLocaleString()}>
                        <span className="text-gray-300 font-mono">{fmt(totalTokens)}</span>
                      </Tip>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Cache efficiency</span>
                      <span className="text-violet-400 font-mono">{cacheHitPct}%</span>
                    </div>
                  </div>
                </div>

                <div className="card p-5">
                  <h3 className="text-sm font-medium text-gray-300 mb-5">Token Breakdown</h3>
                  <div className="space-y-3">
                    {[
                      {
                        label: "Input",
                        value: analyticsData?.tokens.total_input ?? 0,
                        color: "text-blue-400",
                      },
                      {
                        label: "Output",
                        value: analyticsData?.tokens.total_output ?? 0,
                        color: "text-emerald-400",
                      },
                      {
                        label: "Cache Read",
                        value: analyticsData?.tokens.total_cache_read ?? 0,
                        color: "text-violet-400",
                      },
                      {
                        label: "Cache Write",
                        value: analyticsData?.tokens.total_cache_write ?? 0,
                        color: "text-yellow-400",
                      },
                      { label: "Total", value: totalTokens, color: "text-gray-100" },
                    ].map(({ label, value, color }) => (
                      <div
                        key={label}
                        className="flex justify-between items-center py-2 border-b border-border last:border-0"
                      >
                        <span className="text-xs text-gray-400">{label}</span>
                        <span className={`text-sm font-mono font-medium ${color}`}>
                          {value.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                  {totalTokens === 0 && (
                    <p className="text-[11px] text-gray-600 mt-4">
                      Token data will appear once sessions report usage.
                    </p>
                  )}
                </div>

                <div className="card p-5">
                  <h3 className="text-sm font-medium text-gray-300 mb-5">Token Mix</h3>
                  {tokenMixSegments.length === 0 ? (
                    <p className="text-sm text-gray-500">No data</p>
                  ) : (
                    <>
                      <DonutChart segments={tokenMixSegments} formatTotal={(total) => fmt(total)} />
                      <div className="mt-4 pt-4 border-t border-border space-y-2">
                        {tokenMixSegments.map((segment) => (
                          <div key={segment.label} className="flex justify-between text-xs">
                            <span className="text-gray-400">{segment.label}</span>
                            <span className="text-gray-300 font-mono">
                              <Tip raw={segment.value.toLocaleString()}>{fmt(segment.value)}</Tip>
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {analyticsTab === "productivity" && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="card p-5">
                  <h3 className="text-sm font-medium text-gray-300 mb-5">Tool Usage</h3>
                  {(analyticsData?.tool_usage ?? []).length === 0 ? (
                    <p className="text-sm text-gray-500">No tool data yet</p>
                  ) : (
                    <div className="space-y-3">
                      {(analyticsData?.tool_usage ?? [])
                        .slice(0, 12)
                        .map(({ tool_name, count }) => (
                          <BarRow
                            key={tool_name}
                            label={tool_name}
                            count={count}
                            max={maxToolCount}
                            color="bg-yellow-400"
                          />
                        ))}
                    </div>
                  )}
                </div>

                <div className="card p-5">
                  <h3 className="text-sm font-medium text-gray-300 mb-5">Session Outcomes</h3>
                  <DonutChart segments={sessionOutcomeSegments} />
                  <div className="mt-4 pt-4 border-t border-border space-y-1.5">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Total sessions</span>
                      <Tip raw={(analyticsData?.overview.total_sessions ?? 0).toLocaleString()}>
                        <span className="text-gray-300 font-mono">
                          {fmt(analyticsData?.overview.total_sessions ?? 0)}
                        </span>
                      </Tip>
                    </div>
                    {sessionOutcomeSegments.map((s) => (
                      <div
                        key={s.label}
                        className="flex items-center justify-between text-xs text-gray-500"
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: s.color }}
                          />
                          {s.label}
                        </span>
                        <Tip raw={s.value.toLocaleString()}>
                          <span className="text-gray-400 font-mono">{fmt(s.value)}</span>
                        </Tip>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card p-5">
                  <h3 className="text-sm font-medium text-gray-300 mb-5">Daily Session Trends</h3>
                  {dailySessionsLocal.length === 0 ? (
                    <p className="text-sm text-gray-500">No session trend data</p>
                  ) : (
                    <>
                      <Sparkline data={dailySessionsLocal.slice(-30)} color="#6366f1" />
                      <div className="mt-4 space-y-2">
                        {dailySessionsLocal
                          .slice(-7)
                          .reverse()
                          .map(({ date, count }) => {
                            const maxD = Math.max(
                              ...(dailySessionsLocal.length > 0
                                ? dailySessionsLocal
                                : [{ count: 1 }]
                              ).map((d) => d.count)
                            );
                            return (
                              <div key={date} className="flex items-center gap-3">
                                <span className="text-[11px] text-gray-500 font-mono w-20 flex-shrink-0">
                                  {date.slice(5)}
                                </span>
                                <div className="flex-1 bg-surface-3 rounded-full h-1.5">
                                  <div
                                    className="bg-accent h-1.5 rounded-full"
                                    style={{
                                      width: `${Math.round((count / Math.max(maxD, 1)) * 100)}%`,
                                    }}
                                  />
                                </div>
                                <span className="text-[11px] text-gray-500 w-4 text-right">
                                  {count}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                      <p className="text-[11px] text-gray-600 mt-3">Last 7 days</p>
                    </>
                  )}
                </div>
              </div>
            )}

            {analyticsTab === "workflow" && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="card p-5">
                  <h3 className="text-sm font-medium text-gray-300 mb-5">Subagent Types</h3>
                  {(analyticsData?.agent_types ?? []).length === 0 ? (
                    <p className="text-sm text-gray-500">No subagent data yet</p>
                  ) : (
                    <div className="space-y-3">
                      {(analyticsData?.agent_types ?? [])
                        .slice(0, 10)
                        .map(({ subagent_type, count }) => (
                          <BarRow
                            key={subagent_type}
                            label={subagent_type}
                            count={count}
                            max={maxAgentTypeCount}
                            color="bg-violet-400"
                          />
                        ))}
                    </div>
                  )}
                </div>

                <div className="card p-5">
                  <h3 className="text-sm font-medium text-gray-300 mb-5">Agent Status</h3>
                  <DonutChart segments={agentStatusSegments} />
                  <div className="mt-4 pt-4 border-t border-border space-y-1.5">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Total agents</span>
                      <Tip raw={(analyticsData?.overview.total_agents ?? 0).toLocaleString()}>
                        <span className="text-gray-300 font-mono">
                          {fmt(analyticsData?.overview.total_agents ?? 0)}
                        </span>
                      </Tip>
                    </div>
                    {agentStatusSegments.map((s) => (
                      <div
                        key={s.label}
                        className="flex items-center justify-between text-xs text-gray-500"
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: s.color }}
                          />
                          {s.label}
                        </span>
                        <Tip raw={s.value.toLocaleString()}>
                          <span className="text-gray-400 font-mono">{fmt(s.value)}</span>
                        </Tip>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card p-5">
                  <h3 className="text-sm font-medium text-gray-300 mb-5">Event Types</h3>
                  {(analyticsData?.event_types ?? []).length === 0 ? (
                    <p className="text-sm text-gray-500">No event data yet</p>
                  ) : (
                    <div className="space-y-3">
                      {(analyticsData?.event_types ?? []).map(({ event_type, count }) => (
                        <BarRow
                          key={event_type}
                          label={event_type}
                          count={count}
                          max={maxEventTypeCount}
                          color={EVENT_TYPE_COLORS[event_type] ?? "bg-gray-400"}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <SystemHealthTab />
      )}
    </div>
  );
}
