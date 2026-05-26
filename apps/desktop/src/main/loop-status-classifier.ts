// Shared classifier (SSOT): maps a server HTTP response to a typed loop
// disposition. Consumed by loop-heartbeat.ts and boot-recovery.ts. (AC-008)

/** The reason a loop was classified as terminal. */
export type TerminalReason =
  | "timed_out"   // Explicit TIMED_OUT body or status from the server
  | "unauthorized" // HTTP 401 — server cleared loop tokens
  | "not_found"   // HTTP 404 — loop no longer exists
  | "gone";       // HTTP 410 — loop is gone/terminal

/** The reason a loop result is considered transient (do not terminalize). */
export type TransientReason =
  | "server_error"  // HTTP 5xx
  | "network_error"; // null status: network or timeout errors

/** Typed disposition returned by classifyLoopStatus. */
export type LoopStatusDisposition =
  | { kind: "terminal"; reason: TerminalReason }
  | { kind: "live" }
  | { kind: "transient"; reason: TransientReason };

/**
 * Classifies a server response into a typed loop disposition.
 *
 * @param httpStatus - The HTTP status code from the server response, or null
 *   for network/timeout errors where no HTTP response was received.
 * @param cloudKind - The kind string from a `CloudLoopStatus` union variant
 *   (e.g. "timed_out", "active", "unauthorized", "error"), or null when
 *   classifying directly from a `LoopHttpResult` with no cloud status kind.
 * @returns A `LoopStatusDisposition` discriminated union: `terminal` with
 *   reason, `live`, or `transient` with reason.
 */
export function classifyLoopStatus(
  httpStatus: number | null,
  cloudKind: string | null,
): LoopStatusDisposition {
  // Explicit TIMED_OUT kind takes precedence over any HTTP status.
  if (cloudKind === "timed_out") {
    return { kind: "terminal", reason: "timed_out" };
  }

  // An explicit "active" kind is a definitive healthy signal from the cloud
  // reconcile path; it must resolve to `live` rather than falling through to
  // the null-status branch below and being mislabeled a network error.
  if (cloudKind === "active") {
    return { kind: "live" };
  }

  if (httpStatus === null) {
    return { kind: "transient", reason: "network_error" };
  }

  // 401 after token refresh has already run means the server definitively
  // cleared loop tokens -- the loop is dead server-side.
  if (httpStatus === 401) {
    return { kind: "terminal", reason: "unauthorized" };
  }

  if (httpStatus === 404) {
    return { kind: "terminal", reason: "not_found" };
  }

  if (httpStatus === 410) {
    return { kind: "terminal", reason: "gone" };
  }

  if (httpStatus >= 500 && httpStatus <= 599) {
    return { kind: "transient", reason: "server_error" };
  }

  return { kind: "live" };
}
