/**
 * Money math for FEA-1435 cost reconciliation.
 *
 * All reconciliation arithmetic flows through this module. We use integer
 * micro-cents (1¢ = 10_000 microcents = $0.000_01 base unit, or 1 microcent =
 * one ten-thousandth of a cent = $1 / 100_000_000) instead of floats so that
 * vendor-billed and locally-estimated dollars can be summed, compared, and
 * stored without IEEE-754 rounding drift across a 30-day backfill window.
 *
 * Conversion: 1 USD = 100 cents = 100 × 10_000 microcents = 1_000_000 microcents.
 *
 * **Scope discipline:** Only the reconciliation table + the worker uses this.
 * The live UI cost-compute path in agent-session-sync-service.ts stays
 * float-based (see `estimateTokenUsageCostUsd`) — the renderer does not need
 * microcent precision, and changing the contract would ripple across the sync
 * surface. The two paths are intentionally separate.
 */

/**
 * Branded integer count of micro-cents. 1_000_000 microcents = $1.00.
 * The brand prevents accidental mixing with plain numbers in arithmetic.
 */
export type MicroCents = number & { readonly __brand: "MicroCents" };

const MICRO_CENTS_PER_DOLLAR = 1_000_000;

/**
 * JavaScript safe-integer max is 2^53 - 1 ≈ 9.007e15 microcents ≈ $9.007 trillion.
 * Reconciliation rows are per day×model, so even a heavy enterprise user would
 * be many orders of magnitude below this. We still guard so a malformed vendor
 * payload can't silently overflow.
 */
const MAX_SAFE_MICRO_CENTS = Number.MAX_SAFE_INTEGER;

function assertSafeMicroCents(value: number, source: string): MicroCents {
  if (!Number.isFinite(value)) {
    throw new Error(`cost-math: ${source} produced non-finite value`);
  }
  if (Math.abs(value) > MAX_SAFE_MICRO_CENTS) {
    throw new Error(`cost-math: ${source} overflows safe integer range`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`cost-math: ${source} produced non-integer ${value}`);
  }
  return value as MicroCents;
}

/**
 * Half-up round-to-nearest integer. JavaScript's `Math.round` rounds .5
 * toward +∞ — that's fine for positive money but biased for negatives. We
 * use half-up away-from-zero to keep round-trip parsing deterministic.
 */
function roundHalfUp(value: number): number {
  if (value >= 0) {
    return Math.floor(value + 0.5);
  }
  return -Math.floor(-value + 0.5);
}

/**
 * Converts dollars (e.g. 1.2345) to microcents (1_234_500), with half-up
 * rounding so 0.000_005 → 5 and -0.000_005 → -5.
 */
export function dollarsToMicroCents(dollars: number): MicroCents {
  if (!Number.isFinite(dollars)) {
    throw new Error(`cost-math: dollarsToMicroCents received non-finite ${dollars}`);
  }
  const scaled = dollars * MICRO_CENTS_PER_DOLLAR;
  return assertSafeMicroCents(roundHalfUp(scaled), "dollarsToMicroCents");
}

/** Converts microcents back to dollars (lossless for typical magnitudes). */
export function microCentsToDollars(uc: MicroCents): number {
  return (uc as number) / MICRO_CENTS_PER_DOLLAR;
}

/**
 * Parses Anthropic's decimal-string dollar amounts (e.g. `"0.001234"`) into
 * micro-cents. The Cost API returns decimals as strings to preserve precision —
 * we route through string parsing rather than `parseFloat` so that values like
 * `"0.000000001"` (below microcent precision) don't underflow silently.
 *
 * Accepts: an integer or decimal in standard form. Rejects scientific notation,
 * empty strings, NaN, ±Infinity. Negative values are allowed (Anthropic can
 * report credit reversals).
 */
export function parseAnthropicDollars(decimalString: string): MicroCents {
  if (typeof decimalString !== "string") {
    throw new Error("cost-math: parseAnthropicDollars expected string input");
  }
  const trimmed = decimalString.trim();
  if (!trimmed) {
    throw new Error("cost-math: parseAnthropicDollars received empty string");
  }
  // Allow optional leading sign and at most one decimal point. No exponent.
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("cost-math: parseAnthropicDollars rejected malformed input");
  }
  const sign = trimmed.startsWith("-") ? -1 : 1;
  const unsigned = sign === -1 ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = unsigned.split(".");
  // Microcents = whole-dollar-cents × 10_000 + microcent fraction.
  // We compute by string manipulation to avoid float multiplication on the
  // raw dollar string.
  // Pad/truncate fractional part to exactly 6 digits (microcents precision).
  let microFrac: string;
  if (fracPart.length <= 6) {
    microFrac = fracPart.padEnd(6, "0");
  } else {
    // Truncate beyond microcent precision, then round half-up on the cut digit.
    const keep = fracPart.slice(0, 6);
    const cut = fracPart.charCodeAt(6) - 48; // 0..9
    const roundedUp = cut >= 5;
    const keptNum = Number.parseInt(keep, 10);
    const rounded = roundedUp ? keptNum + 1 : keptNum;
    microFrac = String(rounded).padStart(6, "0");
    // Carry into integer part if the rounded fraction reached 1_000_000.
    if (microFrac.length > 6) {
      const overflow = Number.parseInt(microFrac, 10) - 1_000_000;
      microFrac = String(overflow).padStart(6, "0");
      const intNum = Number.parseInt(intPart, 10) + 1;
      return assertSafeMicroCents(
        sign * (intNum * MICRO_CENTS_PER_DOLLAR + Number.parseInt(microFrac, 10)),
        "parseAnthropicDollars",
      );
    }
  }
  const intNum = Number.parseInt(intPart, 10);
  const microFracNum = Number.parseInt(microFrac, 10);
  const total = sign * (intNum * MICRO_CENTS_PER_DOLLAR + microFracNum);
  return assertSafeMicroCents(total, "parseAnthropicDollars");
}

/**
 * Parses OpenAI's numeric dollar amounts (e.g. `0.0125`). The Cost API returns
 * native JSON numbers; we route through `dollarsToMicroCents` so float
 * artifacts are normalized at the boundary.
 */
export function parseOpenAIDollars(numericDollars: number): MicroCents {
  if (typeof numericDollars !== "number" || !Number.isFinite(numericDollars)) {
    throw new Error("cost-math: parseOpenAIDollars expected finite number");
  }
  return dollarsToMicroCents(numericDollars);
}

/** Sums micro-cents safely, asserting overflow. */
export function sumMicroCents(values: MicroCents[]): MicroCents {
  let total = 0;
  for (const v of values) {
    total += v as number;
  }
  return assertSafeMicroCents(total, "sumMicroCents");
}

/**
 * Drift % is defined as `(vendor - local) / vendor`. We anchor on vendor since
 * vendor is the source of truth — a $5 local guess vs a $4 vendor bill is a
 * +25% drift (we overestimated by a quarter of the true cost).
 *
 * Returns null when vendor == 0 (any non-zero local against zero vendor is
 * effectively infinite drift — caller surfaces this as a `trial_credit_applied`
 * hint).
 */
export function driftPct(local: MicroCents, vendor: MicroCents): number | null {
  const v = vendor as number;
  if (v === 0) {
    return null;
  }
  const l = local as number;
  return ((v - l) / Math.abs(v)) * 100;
}

/** Convenience: zero in the branded space. */
export const ZERO_MICRO_CENTS = 0 as MicroCents;

/** Convenience: lift a verified integer microcent count (for tests + callers). */
export function microCentsFromInt(value: number): MicroCents {
  return assertSafeMicroCents(value, "microCentsFromInt");
}
