import type { GitActivityEvent } from "../../shared/git-activity-types.js";
import type { OperationDispatcher } from "../operation-dispatcher.js";
import { json } from "./response-utils.js";

export interface GitActivityRouteDeps {
  /** Returns events from the local activity store (already filtered/limited). */
  list: (opts: { sinceIso?: string; limit?: number }) => GitActivityEvent[];
  /** Clears all retained events. Returns count removed. */
  clear: () => number;
}

/**
 * Routes for the engineer GitHub activity feature (FEA-1226 Phase 1).
 *
 *   GET    /api/gateway/git-activity/recent      — list captured events
 *   DELETE /api/gateway/git-activity/events      — clear retained events
 *
 * The POST ingest route from the FEA-1226 doc is intentionally deferred to
 * Phase 2 (it is the external-shim endpoint, not needed for Phase 1 capture
 * which happens entirely via the in-process session-log tailer).
 *
 * Both routes use the standard gateway auth (session token + matching Origin).
 */
export function registerGitActivityObserverRoutes(
  dispatcher: OperationDispatcher,
  deps: GitActivityRouteDeps,
): void {
  dispatcher.register("GET", "/api/gateway/git-activity/recent", (context) => {
    const limitParam = context.query.get("limit");
    const sinceParam = context.query.get("since");
    let limit: number | undefined;
    if (limitParam !== null) {
      const parsed = Number.parseInt(limitParam, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        json(context, 400, { error: "limit must be a non-negative integer" });
        return;
      }
      limit = Math.min(parsed, 1000);
    }
    const sinceIso =
      sinceParam && sinceParam.trim().length > 0 ? sinceParam : undefined;
    if (sinceIso && Number.isNaN(Date.parse(sinceIso))) {
      json(context, 400, { error: "since must be an ISO-8601 timestamp" });
      return;
    }
    const events = deps.list({ limit, sinceIso });
    json(context, 200, { events });
  });

  dispatcher.register("DELETE", "/api/gateway/git-activity/events", (context) => {
    const cleared = deps.clear();
    json(context, 200, { cleared });
  });
}
