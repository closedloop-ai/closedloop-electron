/**
 * Nightly cost reconciliation worker (FEA-1435).
 *
 * For users who supply an Anthropic and/or OpenAI organization Admin Key, pull
 * authoritative cost data from the vendor Cost APIs nightly, join against
 * locally-aggregated `token_usage` rows in the agent-monitor SQLite DB, and
 * persist a `reconciliation` row per day × vendor × model recording
 * `local_estimate_micro_cents`, `vendor_billed_micro_cents`, drift, and a
 * cause-hint key.
 *
 * v1 runs in the **main** Electron process — there's no separate vendor
 * networking surface, and the request volume is small (≤ 60 HTTP calls / day
 * even with both vendors backfilling). TODO: harden by moving the fetch path
 * to a utility process with `session.fromPartition().setProxy()` network
 * allowlist.
 *
 * Cadence: 24h base interval, jittered ±2h. Configurable via
 * `reconciliationIntervalHours` (default 24, min 6).
 *
 * Each run determines the day-range to backfill (last 30 days minus any
 * already-computed days). First run backfills the full 30 days.
 *
 * Single structured log line per day × vendor × model. No per-request chatty
 * logs (the cost-API clients emit their own coarse-grained summary line).
 *
 * Boot integration: `init()` is called only when (Anthropic OR OpenAI Admin Key
 * is set AND `reconciliationEnabled` setting is on). It runs once if the last
 * run is older than the cadence, else schedules the next firing. `setInterval`
 * is `.unref()`-ed so it never keeps the app alive on quit.
 *
 * Note: this worker depends on FEA-1434, which adds a `billing_mode` column
 * to `sessions`. This worktree is off main and does NOT have that column yet;
 * the aggregation query gracefully falls back to "include all rows" when the
 * column is missing via try/catch on the column-detection probe.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { gatewayLog } from "./gateway-logger.js";
import { AnthropicAdminKeyStore } from "./anthropic-admin-key-store.js";
import { OpenAIAdminKeyStore } from "./openai-admin-key-store.js";
import {
  fetchAnthropicCostReport,
  type AnthropicCostReportRow,
} from "./anthropic-admin-client.js";
import {
  fetchOpenAICosts,
  type OpenAIDailyCostRow,
} from "./openai-admin-client.js";
import {
  driftPct,
  microCentsFromInt,
  sumMicroCents,
  type MicroCents,
} from "./cost-math.js";
import {
  classifyReconciliationCause,
  type ReconciliationCauseHint,
} from "./reconciliation-cause-hint.js";
import {
  fetchClaudeCodeAnalytics,
  ClaudeCodeAnalyticsUnsupportedError,
  type ClaudeCodeAnalyticsUserDay,
} from "./claude-code-analytics-client.js";

const BACKFILL_DAYS = 30;
const CLAUDE_CODE_ANALYTICS_CAPABILITY_KEY = "claude_code_analytics_supported";
const DEFAULT_INTERVAL_HOURS = 24;
const MIN_INTERVAL_HOURS = 6;
const JITTER_HOURS = 2;
const HOUR_MS = 60 * 60 * 1000;

export interface ReconciliationWorkerOptions {
  /** Absolute path to the agent-monitor SQLite DB (dashboard.db). */
  dbPath: string;
  anthropicKeyStore: AnthropicAdminKeyStore;
  openaiKeyStore: OpenAIAdminKeyStore;
  /** Resolves the configured cadence in hours (clamped to >= MIN_INTERVAL_HOURS). */
  getIntervalHours: () => number;
  /** Resolves whether the user has enabled nightly reconciliation. */
  isEnabled: () => boolean;
  /** Test-only override of the fetcher. Production omits this. */
  fetchAnthropic?: typeof fetchAnthropicCostReport;
  /** Test-only override of the fetcher. Production omits this. */
  fetchOpenAI?: typeof fetchOpenAICosts;
  /** Test-only override of the fetcher. Production omits this. */
  fetchClaudeCodeAnalytics?: typeof fetchClaudeCodeAnalytics;
  /** Test-only override of the clock. Production omits this. */
  now?: () => Date;
  /** Test-only override of the timer factory. Production omits this. */
  scheduleTimer?: (cb: () => void, ms: number) => NodeJS.Timeout;
  /** Test-only override of clearTimeout. */
  clearTimer?: (handle: NodeJS.Timeout) => void;
}

export interface ReconciliationStatus {
  lastRunAt: string | null;
  dayRangeCovered: { from: string; to: string } | null;
  avgDriftPct: number | null;
  rowCount: number;
}

interface ReconciliationRow {
  day: string;
  vendor: "anthropic" | "openai";
  model: string;
  localMicroCents: MicroCents;
  vendorMicroCents: MicroCents;
  driftMicroCents: MicroCents;
  driftPct: number | null;
  causeHint: ReconciliationCauseHint | null;
}

interface LocalUsageRow {
  day: string;
  model: string;
  micro_cents: number;
}

/**
 * FEA-1436: shape returned to the renderer via the
 * `cost-reconciliation:get-drift-rows` IPC channel. Numbers are kept as
 * microcents so the renderer can format them consistently with the worker.
 */
export interface DriftDiagnosticsRow {
  day: string;
  vendor: string;
  model: string;
  localEstimateMicroCents: number;
  vendorBilledMicroCents: number;
  driftMicroCents: number;
  driftPct: number | null;
  causeHint: ReconciliationCauseHint | null;
  computedAt: string;
}

export interface DriftRollup {
  avgDriftPct: number | null;
  /** SUM(ABS(drift_micro_cents)) converted to dollars for headline display. */
  totalDriftDollars: number;
  rowCount: number;
  daysCovered: number;
  /**
   * Per-day average drift % across vendors+models. Sparkline-ready. Empty when
   * the reconciliation table has no rows.
   */
  sparklineDaily: { day: string; driftPct: number | null }[];
}

export interface TokenUsageExportRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface DriftExportBlob {
  schemaVersion: 1;
  generatedAt: string;
  reconciliation: DriftDiagnosticsRow;
  tokenUsage: TokenUsageExportRow[];
}

/**
 * FEA-1436: per-user Claude Code Analytics view for the renderer. Empty
 * `users` is the "not supported on this plan tier" signal — the renderer
 * hides the per-user sub-section in that case.
 *
 * `localEstimateUsd` and `gapUsd` are null in v1 because local token_usage
 * has no per-user attribution path (single-tenant Electron app).
 */
export interface ClaudeCodeAnalyticsView {
  users: {
    userId: string;
    daysActive: number;
    sessions: number;
    tokens: number;
    anthropicEstimateUsd: number;
    localEstimateUsd: number | null;
    gapUsd: number | null;
  }[];
}

interface DriftRowRecord {
  day: string;
  vendor: string;
  model: string;
  local_estimate_micro_cents: number;
  vendor_billed_micro_cents: number;
  drift_micro_cents: number;
  drift_pct: number | null;
  cause_hint: string | null;
  computed_at: string;
}

function toDriftDiagnosticsRow(row: DriftRowRecord): DriftDiagnosticsRow {
  return {
    day: row.day,
    vendor: row.vendor,
    model: row.model,
    localEstimateMicroCents: row.local_estimate_micro_cents,
    vendorBilledMicroCents: row.vendor_billed_micro_cents,
    driftMicroCents: row.drift_micro_cents,
    driftPct: row.drift_pct,
    causeHint: (row.cause_hint as ReconciliationCauseHint | null) ?? null,
    computedAt: row.computed_at,
  };
}

export class ReconciliationWorker {
  private readonly options: Required<
    Pick<
      ReconciliationWorkerOptions,
      | "fetchAnthropic"
      | "fetchOpenAI"
      | "fetchClaudeCodeAnalytics"
      | "now"
      | "scheduleTimer"
      | "clearTimer"
    >
  > &
    ReconciliationWorkerOptions;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastRunAt: string | null = null;

  constructor(options: ReconciliationWorkerOptions) {
    this.options = {
      ...options,
      fetchAnthropic: options.fetchAnthropic ?? fetchAnthropicCostReport,
      fetchOpenAI: options.fetchOpenAI ?? fetchOpenAICosts,
      fetchClaudeCodeAnalytics:
        options.fetchClaudeCodeAnalytics ?? fetchClaudeCodeAnalytics,
      now: options.now ?? (() => new Date()),
      scheduleTimer: options.scheduleTimer ?? ((cb, ms) => setTimeout(cb, ms)),
      clearTimer: options.clearTimer ?? ((h) => clearTimeout(h)),
    };
  }

  /**
   * Boot entrypoint. Initializes the reconciliation schema, then either runs
   * immediately (last run > cadence) or schedules the next firing.
   */
  init(): void {
    if (!this.options.isEnabled()) {
      gatewayLog.info("reconciliation", "disabled by setting; worker not started");
      return;
    }
    if (!this.hasAnyKey()) {
      gatewayLog.info("reconciliation", "no admin keys configured; worker not started");
      return;
    }
    try {
      this.ensureSchemaWithOpenedDb();
    } catch (err) {
      gatewayLog.warn(
        "reconciliation",
        `schema init failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    this.lastRunAt = this.readLastRunAt();
    const now = this.options.now().getTime();
    const last = this.lastRunAt ? Date.parse(this.lastRunAt) : 0;
    const cadenceMs = this.cadenceMs();
    const sinceLast = now - last;
    if (sinceLast >= cadenceMs) {
      void this.runOnce({ trigger: "boot-due" });
    }
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) {
      this.options.clearTimer(this.timer);
      this.timer = null;
    }
  }

  /** Triggers an out-of-band run (e.g. from the "Run now" button). */
  async runNow(): Promise<{ queued: boolean }> {
    if (this.running) {
      return { queued: false };
    }
    // FEA-1436: manual runs re-probe Claude Code Analytics even if a prior
    // run cached a negative capability. The user may have upgraded their
    // plan tier or rotated to an Admin Key with the right permission.
    this.clearClaudeCodeAnalyticsCapability();
    void this.runOnce({ trigger: "manual" });
    return { queued: true };
  }

  private clearClaudeCodeAnalyticsCapability(): void {
    try {
      const db = this.openDb();
      try {
        ensureFeatureCapabilitySchema(db);
        db.prepare(`DELETE FROM feature_capability WHERE key = ?`).run(
          CLAUDE_CODE_ANALYTICS_CAPABILITY_KEY,
        );
      } finally {
        db.close();
      }
    } catch {
      /* best-effort */
    }
  }

  /**
   * FEA-1436: called from the IPC layer when the Anthropic Admin Key is
   * cleared or rotated. Removes the cached analytics rows so a key swap
   * between organizations doesn't expose stale per-user attribution from
   * the previous org. Also clears the capability flag so the next probe
   * runs.
   */
  resetClaudeCodeAnalyticsState(): void {
    try {
      const db = this.openDb();
      try {
        ensureClaudeCodeAnalyticsSchema(db);
        ensureFeatureCapabilitySchema(db);
        db.exec(`DELETE FROM claude_code_analytics_daily`);
        db.prepare(`DELETE FROM feature_capability WHERE key = ?`).run(
          CLAUDE_CODE_ANALYTICS_CAPABILITY_KEY,
        );
      } finally {
        db.close();
      }
    } catch {
      /* best-effort */
    }
  }

  getStatus(): ReconciliationStatus {
    try {
      const db = this.openDb();
      try {
        const row = db
          .prepare(
            `SELECT MIN(day) AS from_day, MAX(day) AS to_day, COUNT(*) AS row_count
             FROM reconciliation`,
          )
          .get() as { from_day: string | null; to_day: string | null; row_count: number } | undefined;
        const avgDriftRow = db
          .prepare(
            `SELECT AVG(drift_pct) AS avg_drift
             FROM reconciliation
             WHERE drift_pct IS NOT NULL`,
          )
          .get() as { avg_drift: number | null } | undefined;
        return {
          lastRunAt: this.lastRunAt,
          dayRangeCovered:
            row?.from_day && row?.to_day
              ? { from: row.from_day, to: row.to_day }
              : null,
          avgDriftPct: avgDriftRow?.avg_drift ?? null,
          rowCount: row?.row_count ?? 0,
        };
      } finally {
        db.close();
      }
    } catch {
      return {
        lastRunAt: this.lastRunAt,
        dayRangeCovered: null,
        avgDriftPct: null,
        rowCount: 0,
      };
    }
  }

  /**
   * FEA-1436: returns the last `daysBack` days of reconciliation rows, ordered
   * by day DESC then drift magnitude DESC. Defaults to 30 days. Used by the
   * Cost Reconciliation diagnostics tab.
   */
  getDriftRows(daysBack = 30): DriftDiagnosticsRow[] {
    const clamped = Math.max(1, Math.min(365, Math.floor(daysBack)));
    const sinceDate = new Date(this.options.now());
    sinceDate.setUTCDate(sinceDate.getUTCDate() - clamped);
    const since = sinceDate.toISOString().slice(0, 10);
    try {
      const db = this.openDb();
      try {
        ensureReconciliationSchema(db);
        const rows = db
          .prepare(
            `SELECT day, vendor, model, local_estimate_micro_cents, vendor_billed_micro_cents,
                    drift_micro_cents, drift_pct, cause_hint, computed_at
             FROM reconciliation
             WHERE day >= ?
             ORDER BY day DESC, ABS(COALESCE(drift_pct, 0)) DESC`,
          )
          .all(since) as unknown as DriftRowRecord[];
        return rows.map(toDriftDiagnosticsRow);
      } finally {
        db.close();
      }
    } catch {
      return [];
    }
  }

  /**
   * FEA-1436: 30-day rollup with per-day drift sparkline data. Used by the
   * Cost Reconciliation diagnostics tab.
   */
  getDriftRollup(): DriftRollup {
    try {
      const db = this.openDb();
      try {
        ensureReconciliationSchema(db);
        const rollup = db
          .prepare(
            // FEA-1436: AVG(ABS()) so positive + negative drift on different
            // days don't silently cancel and report 0% when both are real.
            `SELECT AVG(ABS(drift_pct)) AS avg_drift, COUNT(*) AS row_count,
                    SUM(ABS(drift_micro_cents)) AS total_drift_micro_cents
             FROM reconciliation
             WHERE day >= date('now', '-30 days')`,
          )
          .get() as
          | { avg_drift: number | null; row_count: number; total_drift_micro_cents: number | null }
          | undefined;
        // Per-day average drift % for the sparkline. Averaging across vendors+
        // models per day collapses the multi-row breakdown into a single y-value.
        const sparkRows = db
          .prepare(
            `SELECT day, AVG(drift_pct) AS drift_pct
             FROM reconciliation
             WHERE day >= date('now', '-30 days')
             GROUP BY day
             ORDER BY day ASC`,
          )
          .all() as { day: string; drift_pct: number | null }[];
        const totalMicroCents = rollup?.total_drift_micro_cents ?? 0;
        return {
          avgDriftPct: rollup?.avg_drift ?? null,
          totalDriftDollars: totalMicroCents / 1_000_000,
          rowCount: rollup?.row_count ?? 0,
          daysCovered: sparkRows.length,
          sparklineDaily: sparkRows.map((r) => ({
            day: r.day,
            driftPct: r.drift_pct,
          })),
        };
      } finally {
        db.close();
      }
    } catch {
      return {
        avgDriftPct: null,
        totalDriftDollars: 0,
        rowCount: 0,
        daysCovered: 0,
        sparklineDaily: [],
      };
    }
  }

  /**
   * FEA-1436: returns a self-contained JSON blob with the matching
   * reconciliation row + the underlying token_usage rows for the day. Powers
   * the "Export for support" button — the user can attach the file to a
   * support ticket without exposing credentials. Admin Keys, session IDs, and
   * other PII are NOT included.
   */
  exportDay(input: { day: string; vendor: string; model: string }): DriftExportBlob | null {
    try {
      const db = this.openDb();
      try {
        ensureReconciliationSchema(db);
        const reconRow = db
          .prepare(
            `SELECT day, vendor, model, local_estimate_micro_cents, vendor_billed_micro_cents,
                    drift_micro_cents, drift_pct, cause_hint, computed_at
             FROM reconciliation
             WHERE day = ? AND vendor = ? AND model = ?`,
          )
          .get(input.day, input.vendor, input.model) as DriftRowRecord | undefined;
        if (!reconRow) {
          return null;
        }
        // Best-effort token_usage pull. We deliberately omit session_id (PII)
        // and project them to model+token counts only — enough to reproduce
        // the local-estimate math without exposing user content.
        let tokenRows: TokenUsageExportRow[] = [];
        try {
          tokenRows = db
            .prepare(
              `SELECT LOWER(tu.model) AS model,
                      SUM(tu.input_tokens + COALESCE(tu.baseline_input, 0)) AS input_tokens,
                      SUM(tu.output_tokens + COALESCE(tu.baseline_output, 0)) AS output_tokens,
                      SUM(tu.cache_read_tokens + COALESCE(tu.baseline_cache_read, 0)) AS cache_read_tokens,
                      SUM(tu.cache_write_tokens + COALESCE(tu.baseline_cache_write, 0)) AS cache_write_tokens
               FROM token_usage tu
               JOIN sessions s ON s.id = tu.session_id
               WHERE substr(s.started_at, 1, 10) = ?
                 AND LOWER(tu.model) = ?
               GROUP BY LOWER(tu.model)`,
            )
            .all(input.day, input.model.toLowerCase()) as unknown as TokenUsageExportRow[];
        } catch {
          // sessions / token_usage may not exist yet on a freshly-installed
          // app. The export still ships the reconciliation row.
        }
        return {
          schemaVersion: 1,
          generatedAt: this.options.now().toISOString(),
          reconciliation: toDriftDiagnosticsRow(reconRow),
          tokenUsage: tokenRows,
        };
      } finally {
        db.close();
      }
    } catch {
      return null;
    }
  }

  // --- internals ---

  private hasAnyKey(): boolean {
    return Boolean(
      this.options.anthropicKeyStore.get() || this.options.openaiKeyStore.get(),
    );
  }

  private cadenceMs(): number {
    const raw = Math.max(MIN_INTERVAL_HOURS, this.options.getIntervalHours() || DEFAULT_INTERVAL_HOURS);
    return raw * HOUR_MS;
  }

  private jitterMs(): number {
    return (Math.random() * 2 - 1) * JITTER_HOURS * HOUR_MS;
  }

  private scheduleNext(): void {
    if (this.timer) {
      this.options.clearTimer(this.timer);
    }
    const delay = Math.max(HOUR_MS, this.cadenceMs() + this.jitterMs());
    this.timer = this.options.scheduleTimer(() => {
      if (this.options.isEnabled() && this.hasAnyKey()) {
        void this.runOnce({ trigger: "interval" });
      }
      this.scheduleNext();
    }, delay);
    // Allow process exit even with the timer pending. `.unref()` is available
    // on Node Timeout objects; guard for the test-injected timer that may not
    // expose it.
    const maybeUnref = (this.timer as unknown as { unref?: () => void }).unref;
    if (typeof maybeUnref === "function") {
      maybeUnref.call(this.timer);
    }
  }

  private readLastRunAt(): string | null {
    try {
      const db = this.openDb();
      try {
        const row = db
          .prepare(`SELECT MAX(computed_at) AS last_run FROM reconciliation`)
          .get() as { last_run: string | null } | undefined;
        return row?.last_run ?? null;
      } finally {
        db.close();
      }
    } catch {
      return null;
    }
  }

  private async runOnce(meta: { trigger: "boot-due" | "interval" | "manual" }): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const days = this.computeBackfillDays();
      if (days.length === 0) {
        return;
      }
      const windowStart = days[0];
      const windowEnd = days[days.length - 1];
      const startDate = new Date(`${windowStart}T00:00:00Z`);
      const endDate = new Date(`${windowEnd}T00:00:00Z`);
      // Add one day so the vendor's exclusive end-bound includes the final day.
      endDate.setUTCDate(endDate.getUTCDate() + 1);

      const anthropicKey = this.options.anthropicKeyStore.get();
      const openaiKey = this.options.openaiKeyStore.get();

      const rows: ReconciliationRow[] = [];

      if (anthropicKey) {
        try {
          const vendorRows = await this.options.fetchAnthropic(anthropicKey, {
            startingAt: startDate.toISOString(),
            endingAt: endDate.toISOString(),
          });
          const localByKey = this.aggregateLocalUsage("anthropic", days);
          rows.push(...joinAnthropic(vendorRows, localByKey, days));
        } catch (err) {
          gatewayLog.warn(
            "reconciliation",
            `anthropic fetch failed trigger=${meta.trigger} error=${classifyError(err)}`,
          );
        }
      }

      if (openaiKey) {
        try {
          const startUnix = Math.floor(startDate.getTime() / 1000);
          const endUnix = Math.floor(endDate.getTime() / 1000);
          const vendorRows = await this.options.fetchOpenAI(openaiKey, {
            startTime: startUnix,
            endTime: endUnix,
          });
          const localByKey = this.aggregateLocalUsage("openai", days);
          rows.push(...joinOpenAI(vendorRows, localByKey, days));
        } catch (err) {
          gatewayLog.warn(
            "reconciliation",
            `openai fetch failed trigger=${meta.trigger} error=${classifyError(err)}`,
          );
        }
      }

      if (rows.length > 0) {
        this.persistRows(rows);
      }

      // FEA-1436: Claude Code Analytics (Team/Enterprise gated).
      //
      // The endpoint only exists for orgs with the right Admin API permission;
      // Solo/Pro plans return 404 and unauthorized Team keys return 403. We
      // cache that negative as a feature_capability flag so subsequent runs
      // don't re-hit the endpoint just to be rejected. The cached negative is
      // cleared when the user clears or rotates their Anthropic Admin Key.
      let claudeCodeAttempts = 0;
      let claudeCodeRows = 0;
      if (anthropicKey && this.isClaudeCodeAnalyticsSupported()) {
        claudeCodeAttempts = 1;
        try {
          const analyticsResult = await this.options.fetchClaudeCodeAnalytics(
            anthropicKey,
            {
              startingAt: startDate.toISOString(),
              endingAt: endDate.toISOString(),
            },
          );
          if (analyticsResult.users.length > 0) {
            claudeCodeRows = this.persistClaudeCodeAnalyticsRows(
              analyticsResult.users,
            );
          }
        } catch (err) {
          if (err instanceof ClaudeCodeAnalyticsUnsupportedError) {
            // Persist the negative capability so we don't retry on every run.
            this.setClaudeCodeAnalyticsCapability(false);
            gatewayLog.info(
              "reconciliation",
              `claude_code_analytics unsupported status=${err.status}; capability flag cached, skipping on subsequent runs`,
            );
          } else {
            gatewayLog.warn(
              "reconciliation",
              `claude_code_analytics fetch failed trigger=${meta.trigger} error=${classifyError(err)}`,
            );
          }
        }
      }

      this.lastRunAt = this.options.now().toISOString();
      gatewayLog.info(
        "reconciliation",
        `run complete trigger=${meta.trigger} days=${days.length} rows=${rows.length} cc_attempts=${claudeCodeAttempts} cc_rows=${claudeCodeRows}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * FEA-1436: returns true unless we've persisted a negative capability flag
   * from a prior run. Default-true so the first run actually probes the
   * endpoint; the negative gets cached after a single 403/404.
   */
  private isClaudeCodeAnalyticsSupported(): boolean {
    try {
      const db = this.openDb();
      try {
        ensureFeatureCapabilitySchema(db);
        const row = db
          .prepare(
            `SELECT value FROM feature_capability WHERE key = ?`,
          )
          .get(CLAUDE_CODE_ANALYTICS_CAPABILITY_KEY) as
          | { value: string | null }
          | undefined;
        if (!row) {
          return true;
        }
        return row.value !== "false";
      } finally {
        db.close();
      }
    } catch {
      return true;
    }
  }

  private setClaudeCodeAnalyticsCapability(supported: boolean): void {
    try {
      const db = this.openDb();
      try {
        ensureFeatureCapabilitySchema(db);
        db.prepare(
          `INSERT INTO feature_capability (key, value, computed_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             computed_at = excluded.computed_at`,
        ).run(
          CLAUDE_CODE_ANALYTICS_CAPABILITY_KEY,
          supported ? "true" : "false",
          this.options.now().toISOString(),
        );
      } finally {
        db.close();
      }
    } catch {
      /* best-effort */
    }
  }

  private persistClaudeCodeAnalyticsRows(
    users: ClaudeCodeAnalyticsUserDay[],
  ): number {
    try {
      const db = this.openDb();
      try {
        ensureClaudeCodeAnalyticsSchema(db);
        // FEA-1436: the Claude Code Analytics API can return multiple records
        // per user/day when the same user used Claude Code from different
        // terminal_types or under multiple customer_types. We fold by
        // (day, userId) before insert so the upsert doesn't overwrite
        // earlier rows with later, partial data.
        const folded = new Map<
          string,
          {
            day: string;
            userId: string;
            sessions: number;
            tokens: number;
            microCents: number;
          }
        >();
        for (const u of users) {
          const key = `${u.day}::${u.userId}`;
          const microCents = Math.round(u.estimatedCostUsd * 1_000_000);
          const existing = folded.get(key);
          if (existing) {
            existing.sessions += u.sessions;
            existing.tokens += u.tokens;
            existing.microCents += microCents;
          } else {
            folded.set(key, {
              day: u.day,
              userId: u.userId,
              sessions: u.sessions,
              tokens: u.tokens,
              microCents,
            });
          }
        }
        const insert = db.prepare(`
          INSERT INTO claude_code_analytics_daily (
            day, user_id, sessions, tokens, estimated_cost_micro_cents, computed_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(day, user_id) DO UPDATE SET
            sessions = excluded.sessions,
            tokens = excluded.tokens,
            estimated_cost_micro_cents = excluded.estimated_cost_micro_cents,
            computed_at = excluded.computed_at
        `);
        const computedAt = this.options.now().toISOString();
        let written = 0;
        for (const f of folded.values()) {
          insert.run(
            f.day,
            f.userId,
            f.sessions,
            f.tokens,
            f.microCents,
            computedAt,
          );
          written += 1;
        }
        return written;
      } finally {
        db.close();
      }
    } catch {
      return 0;
    }
  }

  /**
   * FEA-1436: returns per-user Claude Code analytics rows joined against the
   * local token-usage estimate. Empty when the table doesn't exist yet (i.e.
   * the org's plan tier doesn't include the endpoint). Used by the
   * Per-user attribution sub-section in the Cost Reconciliation tab.
   */
  getClaudeCodeAnalytics(): ClaudeCodeAnalyticsView {
    try {
      const db = this.openDb();
      try {
        ensureClaudeCodeAnalyticsSchema(db);
        const rows = db
          .prepare(
            `SELECT user_id,
                    COUNT(DISTINCT day) AS days_active,
                    SUM(sessions) AS sessions,
                    SUM(tokens) AS tokens,
                    SUM(estimated_cost_micro_cents) AS anthropic_micro_cents
             FROM claude_code_analytics_daily
             WHERE day >= date('now', '-30 days')
             GROUP BY user_id
             ORDER BY tokens DESC`,
          )
          .all() as {
          user_id: string;
          days_active: number;
          sessions: number;
          tokens: number;
          anthropic_micro_cents: number;
        }[];
        return {
          users: rows.map((r) => ({
            userId: r.user_id,
            daysActive: r.days_active,
            sessions: r.sessions,
            tokens: r.tokens,
            anthropicEstimateUsd: (r.anthropic_micro_cents ?? 0) / 1_000_000,
            // FEA-1436 v1 ships without a local-by-user attribution path —
            // local token_usage has no user_id (single-tenant app). Surface
            // as null so the renderer can render a "—" placeholder rather
            // than fabricate a number.
            localEstimateUsd: null,
            gapUsd: null,
          })),
        };
      } finally {
        db.close();
      }
    } catch {
      return { users: [] };
    }
  }

  private computeBackfillDays(): string[] {
    const now = this.options.now();
    const days: string[] = [];
    for (let i = BACKFILL_DAYS; i >= 1; i -= 1) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    return days;
  }

  /**
   * Aggregates local token_usage cost into microcents per day × model.
   *
   * FEA-1434 will add a `billing_mode` column to `sessions` so we can filter
   * to user-billed API rows. This worktree is off main and does NOT have that
   * column — we probe for it with a SELECT and fall back to including all rows
   * when missing.
   *
   * Vendor filtering uses model-name prefix heuristics (claude-/anthropic-
   * vs gpt-/o1-/o3-/o4-).
   */
  private aggregateLocalUsage(
    vendor: "anthropic" | "openai",
    days: string[],
  ): Map<string, MicroCents> {
    const result = new Map<string, MicroCents>();
    if (days.length === 0) {
      return result;
    }
    const db = this.openDb();
    try {
      const billingModeAvailable = probeBillingModeColumn(db);
      const billingClause = billingModeAvailable
        ? "AND COALESCE(s.billing_mode, 'api') = 'api'"
        : "";
      const vendorPrefixes =
        vendor === "anthropic"
          ? ["claude", "anthropic"]
          : ["gpt", "o1", "o3", "o4", "openai"];
      const placeholders = vendorPrefixes.map(() => "tu.model LIKE ? || '%'").join(" OR ");
      const minDay = days[0];
      const maxDay = days[days.length - 1];
      const sql = `
        SELECT
          substr(s.started_at, 1, 10) AS day,
          LOWER(tu.model) AS model,
          COALESCE(SUM(tu.input_tokens + COALESCE(tu.baseline_input, 0)) * COALESCE(mp.input_per_mtok, 0)
                 + SUM(tu.output_tokens + COALESCE(tu.baseline_output, 0)) * COALESCE(mp.output_per_mtok, 0)
                 + SUM(tu.cache_read_tokens + COALESCE(tu.baseline_cache_read, 0)) * COALESCE(mp.cache_read_per_mtok, 0)
                 + SUM(tu.cache_write_tokens + COALESCE(tu.baseline_cache_write, 0)) * COALESCE(mp.cache_write_per_mtok, 0), 0) AS micro_cents
        FROM token_usage tu
        JOIN sessions s ON s.id = tu.session_id
        LEFT JOIN model_pricing mp ON LOWER(tu.model) LIKE LOWER(mp.model_pattern)
        WHERE substr(s.started_at, 1, 10) >= ?
          AND substr(s.started_at, 1, 10) <= ?
          AND (${placeholders})
          ${billingClause}
        GROUP BY day, LOWER(tu.model)
      `;
      const rows = db.prepare(sql).all(minDay, maxDay, ...vendorPrefixes) as unknown as LocalUsageRow[];
      for (const row of rows) {
        // The aggregate above is in tokens-per-million × dollars-per-mtok units,
        // which works out to dollars. Convert to microcents.
        const dollars = row.micro_cents / 1_000_000;
        const microCents = Math.round(dollars * 100 * 10_000);
        try {
          const safe = microCentsFromInt(microCents);
          const key = `${row.day}::${row.model}`;
          result.set(key, sumMicroCents([result.get(key) ?? (0 as MicroCents), safe]));
        } catch {
          // Skip overflow / non-integer aggregates.
        }
      }
    } finally {
      db.close();
    }
    return result;
  }

  private persistRows(rows: ReconciliationRow[]): void {
    const db = this.openDb();
    try {
      ensureReconciliationSchema(db);
      const insert = db.prepare(`
        INSERT INTO reconciliation (
          day, vendor, model,
          local_estimate_micro_cents, vendor_billed_micro_cents,
          drift_micro_cents, drift_pct, cause_hint, computed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(day, vendor, model) DO UPDATE SET
          local_estimate_micro_cents = excluded.local_estimate_micro_cents,
          vendor_billed_micro_cents = excluded.vendor_billed_micro_cents,
          drift_micro_cents = excluded.drift_micro_cents,
          drift_pct = excluded.drift_pct,
          cause_hint = excluded.cause_hint,
          computed_at = excluded.computed_at
      `);
      const computedAt = this.options.now().toISOString();
      for (const row of rows) {
        insert.run(
          row.day,
          row.vendor,
          row.model,
          row.localMicroCents as number,
          row.vendorMicroCents as number,
          row.driftMicroCents as number,
          row.driftPct,
          row.causeHint,
          computedAt,
        );
        gatewayLog.info(
          "reconciliation",
          `row day=${row.day} vendor=${row.vendor} model=${row.model} local=${row.localMicroCents} vendor=${row.vendorMicroCents} drift_pct=${row.driftPct?.toFixed(2) ?? "null"} cause=${row.causeHint ?? "none"}`,
        );
      }
    } finally {
      db.close();
    }
  }

  private ensureSchemaWithOpenedDb(): void {
    const db = this.openDb();
    try {
      ensureReconciliationSchema(db);
    } finally {
      db.close();
    }
  }

  private openDb(): DatabaseSync {
    if (!existsSync(this.options.dbPath)) {
      // Touch the file by opening it — node:sqlite creates on first open.
    }
    return new DatabaseSync(this.options.dbPath);
  }
}

/**
 * Creates the reconciliation table if absent. Idempotent. Schema matches the
 * FEA-1435 spec verbatim.
 */
export function ensureReconciliationSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reconciliation (
      day TEXT NOT NULL,
      vendor TEXT NOT NULL,
      model TEXT NOT NULL,
      local_estimate_micro_cents INTEGER NOT NULL DEFAULT 0,
      vendor_billed_micro_cents INTEGER NOT NULL DEFAULT 0,
      drift_micro_cents INTEGER NOT NULL DEFAULT 0,
      drift_pct REAL,
      cause_hint TEXT,
      computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (day, vendor, model)
    );
    CREATE INDEX IF NOT EXISTS idx_reconciliation_day ON reconciliation(day DESC);
    CREATE INDEX IF NOT EXISTS idx_reconciliation_drift ON reconciliation(ABS(drift_pct) DESC);
  `);
}

/**
 * FEA-1436: small key/value table for plan-tier capability flags discovered
 * at runtime. Currently holds `claude_code_analytics_supported` — the row is
 * absent on first boot (treated as supported, the next run probes) and is
 * upserted to `"false"` after a 403/404 so subsequent runs short-circuit.
 * Idempotent.
 */
export function ensureFeatureCapabilitySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feature_capability (
      key TEXT PRIMARY KEY,
      value TEXT,
      computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
}

/**
 * FEA-1436: per-user-per-day rollup persisted from the Claude Code Analytics
 * API. Created on first successful fetch. Schema matches the FEA-1436 spec.
 * Idempotent.
 */
export function ensureClaudeCodeAnalyticsSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS claude_code_analytics_daily (
      day TEXT NOT NULL,
      user_id TEXT NOT NULL,
      sessions INTEGER NOT NULL,
      tokens INTEGER NOT NULL,
      estimated_cost_micro_cents INTEGER NOT NULL,
      computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (day, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cc_analytics_day ON claude_code_analytics_daily(day DESC);
  `);
}

/**
 * Probes for FEA-1434's `billing_mode` column on `sessions`. Try/catch on a
 * SELECT works on both node:sqlite (throws synchronously) and the upstream
 * better-sqlite3 path.
 */
function probeBillingModeColumn(db: DatabaseSync): boolean {
  try {
    db.prepare(`SELECT billing_mode FROM sessions LIMIT 1`).get();
    return true;
  } catch {
    return false;
  }
}

export function joinAnthropic(
  vendorRows: AnthropicCostReportRow[],
  localByKey: Map<string, MicroCents>,
  days: string[],
): ReconciliationRow[] {
  return joinVendorRows("anthropic", vendorRows, localByKey, days, (vr) => ({
    day: vr.day,
    model: vr.model,
    costMicroCents: vr.costMicroCents,
    descriptionGroup: vr.descriptionGroup,
    costType: vr.costType,
    serviceTier: vr.serviceTier,
    tokenType: vr.tokenType,
  }));
}

export function joinOpenAI(
  vendorRows: OpenAIDailyCostRow[],
  localByKey: Map<string, MicroCents>,
  days: string[],
): ReconciliationRow[] {
  return joinVendorRows("openai", vendorRows, localByKey, days, (vr) => ({
    day: vr.day,
    model: vr.model,
    costMicroCents: vr.costMicroCents,
  }));
}

interface NormalizedVendorRow {
  day: string;
  model: string;
  costMicroCents: MicroCents;
  descriptionGroup?: string | null;
  costType?: string | null;
  serviceTier?: string | null;
  tokenType?: string | null;
}

function joinVendorRows<TRow>(
  vendor: "anthropic" | "openai",
  vendorRows: TRow[],
  localByKey: Map<string, MicroCents>,
  days: string[],
  normalize: (row: TRow) => NormalizedVendorRow,
): ReconciliationRow[] {
  const allowedDays = new Set(days);
  // Fold vendor rows by (day, model) so multiple breakdowns collapse into one.
  const vendorByKey = new Map<
    string,
    {
      total: MicroCents;
      descriptions: string[];
      costTypes: string[];
      serviceTiers: string[];
      tokenTypes: string[];
    }
  >();
  for (const raw of vendorRows) {
    const v = normalize(raw);
    if (!allowedDays.has(v.day)) {
      continue;
    }
    const key = `${v.day}::${v.model}`;
    const slot = vendorByKey.get(key) ?? {
      total: 0 as MicroCents,
      descriptions: [],
      costTypes: [],
      serviceTiers: [],
      tokenTypes: [],
    };
    slot.total = sumMicroCents([slot.total, v.costMicroCents]);
    if (v.descriptionGroup) slot.descriptions.push(v.descriptionGroup);
    if (v.costType) slot.costTypes.push(v.costType);
    if (v.serviceTier) slot.serviceTiers.push(v.serviceTier);
    if (v.tokenType) slot.tokenTypes.push(v.tokenType);
    vendorByKey.set(key, slot);
  }
  // Union vendor + local keys so days where local exists but vendor doesn't
  // (or vice versa) still produce rows.
  const keys = new Set<string>([...vendorByKey.keys(), ...localByKey.keys()]);
  const out: ReconciliationRow[] = [];
  for (const key of keys) {
    const [day, model] = key.split("::");
    if (!allowedDays.has(day)) {
      continue;
    }
    const local = localByKey.get(key) ?? (0 as MicroCents);
    const vendorSlot = vendorByKey.get(key);
    const vendorAmt = vendorSlot?.total ?? (0 as MicroCents);
    const drift = ((vendorAmt as number) - (local as number)) as MicroCents;
    const pct = driftPct(local, vendorAmt);
    const hint = classifyReconciliationCause({
      vendor,
      localMicroCents: local,
      vendorMicroCents: vendorAmt,
      driftPct: pct,
      descriptionGroup: vendorSlot?.descriptions[0] ?? null,
      costType: vendorSlot?.costTypes[0] ?? null,
      serviceTier: vendorSlot?.serviceTiers[0] ?? null,
      tokenType: vendorSlot?.tokenTypes[0] ?? null,
    });
    out.push({
      day,
      vendor,
      model,
      localMicroCents: local,
      vendorMicroCents: vendorAmt,
      driftMicroCents: drift,
      driftPct: pct,
      causeHint: hint,
    });
  }
  return out;
}

function classifyError(err: unknown): string {
  if (err && typeof err === "object" && "name" in err) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string") {
      return name;
    }
  }
  return "unknown";
}
