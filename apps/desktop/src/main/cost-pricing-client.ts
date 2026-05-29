/**
 * FEA-1433: HTTP client + Zod validation for the sidecar pricing endpoints.
 *
 *   - listUnpricedModels  -> GET  /api/pricing/diagnostics/unpriced-models
 *   - addPricingRule      -> PUT  /api/pricing (after Zod validation)
 *
 * Lives in its own file (no `electron` import) so node:test unit tests can
 * exercise it under plain Node — `cost-pricing-ipc.ts` only wires `ipcMain`.
 *
 * The sidecar HTTP endpoint is preferred over a direct DB write because:
 *   1. The sidecar owns the SQLite handle (FEA-1363 write-contention fix
 *      relies on BEGIN IMMEDIATE), so it must serialize writes.
 *   2. Reusing the existing `PUT /api/pricing` route preserves the upstream
 *      validation + cache reload behavior.
 *
 * Both functions return `null` / `{ ok: false, error }` (never throw) when
 * the sidecar is unreachable so the renderer can show a graceful
 * "sidecar disabled" state instead of an uncaught IPC error.
 */
import { z } from "zod";

const PricingRuleSchema = z.object({
  model_pattern: z.string().trim().min(1, "model_pattern is required"),
  display_name: z.string().trim().min(1, "display_name is required"),
  input_per_mtok: z.number().finite().min(0).default(0),
  output_per_mtok: z.number().finite().min(0).default(0),
  cache_read_per_mtok: z.number().finite().min(0).default(0),
  cache_write_per_mtok: z.number().finite().min(0).default(0),
  // FEA-1432: 1-hour Anthropic ephemeral cache tier. Optional in the form so
  // OpenAI/Gemini rules can omit it; we always send a number (default 0) to
  // the sidecar to keep the upstream upsert anchored on a stable shape.
  cache_write_1h_per_mtok: z.number().finite().min(0).default(0),
});

export type PricingRuleInput = z.infer<typeof PricingRuleSchema>;

export interface AgentMonitorRef {
  getUrl(): string | null;
}

export interface UnpricedModelRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface UnpricedModelsResponse {
  unpriced_models: UnpricedModelRow[];
}

const SIDECAR_TIMEOUT_MS = 2_000;

export async function fetchUnpricedModels(
  agentMonitor: AgentMonitorRef,
  limit = 20,
  fetchImpl: typeof fetch = fetch,
): Promise<UnpricedModelsResponse | null> {
  const baseUrl = agentMonitor.getUrl();
  if (!baseUrl) return null;
  try {
    const response = await fetchImpl(
      `${baseUrl}/api/pricing/diagnostics/unpriced-models?limit=${encodeURIComponent(String(limit))}`,
      { signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS) },
    );
    if (!response.ok) return null;
    return (await response.json()) as UnpricedModelsResponse;
  } catch {
    return null;
  }
}

export async function addPricingRule(
  agentMonitor: AgentMonitorRef,
  raw: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = PricingRuleSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; "),
    };
  }
  const baseUrl = agentMonitor.getUrl();
  if (!baseUrl) {
    return { ok: false, error: "Agent Dashboard sidecar is not running." };
  }
  try {
    const response = await fetchImpl(`${baseUrl}/api/pricing`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
    });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errBody = (await response.json()) as { error?: { message?: string } };
        if (errBody?.error?.message) detail = errBody.error.message;
      } catch {
        /* fall through with HTTP status */
      }
      return { ok: false, error: detail };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Sidecar request failed",
    };
  }
}
