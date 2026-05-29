// Fetches LiteLLM's model_prices_and_context_window.json and vendors a
// filtered, ClosedLoop-shaped 6-tuple representation alongside an SHA-pinned
// meta file. Targets Node >= 22; no extra dependencies (uses built-ins only).
//
// Output is consumed at agent-monitor build time by build-agent-monitor.mjs
// (see loadHostDefaultPricing()), which concatenates these rows with the
// host-owned overrides for fallback patterns LiteLLM doesn't carry.
//
// CLI flags:
//   --verify              Re-fetch, compare SHA against meta file, exit 1 on
//                         mismatch. Does NOT write any files.
//   --out-dir <path>      Output directory (default: this script's directory).
//
// Tests live at apps/desktop/test/fetch-litellm-pricing.test.ts. The exported
// helpers (fetchLiteLLMPricing, transformPricingMap, deriveDisplayName) keep
// the script unit-test-friendly.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LITELLM_SOURCE_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const SUPPORTED_PREFIXES = [
  "claude-",
  "gpt-",
  "o1-",
  "o3-",
  "gemini-",
];

// LiteLLM has a synthetic "sample_spec" entry at the top of the file that
// documents the schema. It's not a real model.
const SKIP_KEYS = new Set(["sample_spec"]);

const VENDOR_LABEL_WORDS = new Set([
  "claude",
  "gpt",
  "o1",
  "o3",
  "gemini",
  "opus",
  "sonnet",
  "haiku",
  "pro",
  "flash",
  "mini",
  "nano",
  "preview",
  "codex",
  "instruct",
  "turbo",
  "ultra",
]);

/**
 * Convert a LiteLLM key like "claude-opus-4-7" or "gpt-5-codex" into a
 * human-readable display name like "Claude Opus 4.7" or "GPT-5 Codex".
 *
 * Heuristic:
 * - Drop trailing date suffix (e.g. "-20240620").
 * - Split on "-".
 * - First token is the vendor word (Claude, GPT, O1, O3, Gemini); capitalize
 *   with model-family specific rules ("gpt" → "GPT", "o1" → "o1").
 * - For Claude-style families ("opus", "sonnet", "haiku"), join consecutive
 *   numeric tokens after the family word as a dotted version
 *   ("opus-4-7" → "Opus 4.7"). The remaining tokens are capitalized.
 * - For GPT/Gemini, the version sits right next to the vendor token
 *   ("gpt-5" → "GPT-5", "gemini-2.5-pro" → "Gemini 2.5 Pro"). Numeric tokens
 *   immediately after the version stay dotted ("gpt-5-codex" → "GPT-5 Codex",
 *   "gpt-4o" stays "GPT-4o").
 */
export function deriveDisplayName(key) {
  if (typeof key !== "string" || key.length === 0) {
    return "";
  }
  // Strip a trailing date suffix like "-20240620" (8 digits).
  const trimmed = key.replace(/-\d{8}$/, "");
  const tokens = trimmed.split("-").filter((t) => t.length > 0);
  if (tokens.length === 0) return "";

  const head = tokens[0].toLowerCase();
  let vendor;
  if (head === "claude") {
    vendor = "Claude";
  } else if (head === "gpt") {
    vendor = "GPT";
  } else if (head === "o1" || head === "o3") {
    vendor = head;
  } else if (head === "gemini") {
    vendor = "Gemini";
  } else {
    vendor = capitalize(head);
  }

  const rest = tokens.slice(1);

  // Group consecutive numeric tokens into a dotted version, e.g.
  // ["opus","4","7"] → ["Opus", "4.7"]; ["2","5","pro"] → ["2.5", "Pro"].
  /** @type {string[]} */
  const out = [];
  let i = 0;
  while (i < rest.length) {
    const token = rest[i];
    if (/^\d+$/.test(token)) {
      const nums = [token];
      let j = i + 1;
      while (j < rest.length && /^\d+$/.test(rest[j])) {
        nums.push(rest[j]);
        j++;
      }
      out.push(nums.join("."));
      i = j;
    } else {
      out.push(capitalizeWord(token));
      i++;
    }
  }

  // Special case: GPT family with a version like "5" or "4o" needs to merge
  // with the vendor as "GPT-5" / "GPT-4o" rather than "GPT 5" / "GPT 4o" to
  // match the conventional OpenAI rendering. Match purely numeric ("4",
  // "5.5") or numeric-leading alphanumeric ("4o", "4.5-turbo" already split).
  if (vendor === "GPT" && out.length > 0 && /^\d[\d.a-z]*$/.test(out[0])) {
    const version = out.shift();
    return [`${vendor}-${version}`, ...out].join(" ").trim();
  }
  // o1/o3 + version stays hyphenated: "o1-preview" → "o1-Preview"? No, we
  // want "o1-preview". Reformat as lower-cased.
  if ((vendor === "o1" || vendor === "o3") && out.length > 0) {
    return [vendor, ...out].join("-").toLowerCase();
  }

  return [vendor, ...out].join(" ").trim();
}

function capitalize(s) {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function capitalizeWord(s) {
  // Keep known acronyms uppercase, capitalize known model-family words.
  const lower = s.toLowerCase();
  if (lower === "gpt") return "GPT";
  if (lower === "ai") return "AI";
  if (VENDOR_LABEL_WORDS.has(lower)) return capitalize(lower);
  // Mixed alphanumeric like "4o" stays "4o"; otherwise capitalize first char.
  if (/^\d/.test(lower)) return lower;
  return capitalize(lower);
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function isSupportedKey(key) {
  if (SKIP_KEYS.has(key)) return false;
  return SUPPORTED_PREFIXES.some((p) => key.startsWith(p));
}

function roundTo6(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.round(n * 1_000_000) / 1_000_000;
}

/**
 * Transform the parsed LiteLLM JSON object into ClosedLoop's 6-tuple shape,
 * sorted by model_pattern.
 *
 * @param {Record<string, unknown>} pricingMap
 * @returns {Array<[string, string, number, number, number, number]>}
 */
export function transformPricingMap(pricingMap) {
  /** @type {Array<[string, string, number, number, number, number]>} */
  const rows = [];
  for (const [key, entryRaw] of Object.entries(pricingMap)) {
    if (!isSupportedKey(key)) continue;
    if (!entryRaw || typeof entryRaw !== "object") continue;
    const entry = /** @type {Record<string, unknown>} */ (entryRaw);

    const inputPerToken = numberOrNull(entry.input_cost_per_token);
    const outputPerToken = numberOrNull(entry.output_cost_per_token);
    // LiteLLM doesn't always carry both; skip rows missing both.
    if (inputPerToken == null && outputPerToken == null) continue;

    const cacheReadPerToken = numberOrNull(entry.cache_read_input_token_cost);
    const cacheWritePerToken = numberOrNull(
      entry.cache_creation_input_token_cost,
    );

    rows.push([
      `${key}%`,
      deriveDisplayName(key),
      roundTo6((inputPerToken ?? 0) * 1_000_000),
      roundTo6((outputPerToken ?? 0) * 1_000_000),
      roundTo6((cacheReadPerToken ?? 0) * 1_000_000),
      roundTo6((cacheWritePerToken ?? 0) * 1_000_000),
    ]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return rows;
}

function numberOrNull(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/**
 * Download the upstream JSON. Returns both the raw bytes (for SHA pinning)
 * and the parsed object. Throws on non-200 or unparseable JSON.
 *
 * @param {string} [url]
 * @returns {Promise<{ rawText: string, sha: string, parsed: Record<string, unknown> }>}
 */
export async function fetchLiteLLMPricing(url = LITELLM_SOURCE_URL) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `LiteLLM fetch failed: HTTP ${response.status} ${response.statusText} from ${url}`,
    );
  }
  // GitHub raw content sometimes serves text/plain; we assert via parse below
  // rather than the header alone.
  const rawText = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `LiteLLM fetch returned unparseable JSON from ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `LiteLLM fetch returned non-object JSON from ${url}: ${typeof parsed}`,
    );
  }
  const entryCount = Object.keys(parsed).length;
  if (entryCount < 100) {
    throw new Error(
      `LiteLLM fetch returned only ${entryCount} entries (expected ≥ 100) from ${url}`,
    );
  }
  const sha = createHash("sha256").update(rawText).digest("hex");
  return { rawText, sha, parsed };
}

/**
 * @param {{ outDir: string, sourceUrl?: string }} options
 */
export async function runFetchAndWrite({ outDir, sourceUrl = LITELLM_SOURCE_URL }) {
  const { sha, parsed } = await fetchLiteLLMPricing(sourceUrl);
  const rows = transformPricingMap(parsed);
  // Floor + sentinel checks: a partial upstream response that only contains a
  // handful of supported rows would otherwise vendor a near-empty file and
  // silently route most models to the fallback rules. The 20-row floor is
  // a deliberate slack against the ~175 rows we see in steady state; the
  // sentinel must always be present in any LiteLLM corpus carrying Claude
  // pricing.
  if (rows.length < 20) {
    throw new Error(
      `LiteLLM fetch produced only ${rows.length} supported rows after filtering (expected ≥ 20). Vendor prefix list or upstream structure may have changed.`,
    );
  }
  const patterns = new Set(rows.map((r) => r[0]));
  const SENTINELS = ["claude-3-opus-20240229%", "claude-opus-4-1%"];
  for (const sentinel of SENTINELS) {
    if (!patterns.has(sentinel)) {
      throw new Error(
        `LiteLLM fetch missing sentinel model "${sentinel}" — upstream JSON shape may have changed; refusing to vendor.`,
      );
    }
  }
  const fetchedAt = new Date().toISOString();
  const jsonPath = path.join(outDir, "litellm-pricing.json");
  const metaPath = path.join(outDir, "litellm-pricing.meta.json");

  await mkdir(outDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  await writeFile(
    metaPath,
    `${JSON.stringify(
      {
        source_url: sourceUrl,
        source_sha: sha,
        fetched_at: fetchedAt,
        row_count: rows.length,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { jsonPath, metaPath, sha, rowCount: rows.length };
}

/**
 * @param {{ outDir: string, sourceUrl?: string }} options
 */
export async function runVerify({ outDir, sourceUrl = LITELLM_SOURCE_URL }) {
  const metaPath = path.join(outDir, "litellm-pricing.meta.json");
  let metaText;
  try {
    metaText = await readFile(metaPath, "utf8");
  } catch (error) {
    throw new Error(
      `--verify: could not read ${metaPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  /** @type {{ source_sha?: string }} */
  const meta = JSON.parse(metaText);
  if (typeof meta.source_sha !== "string") {
    throw new Error(`--verify: ${metaPath} missing source_sha field`);
  }
  const { sha } = await fetchLiteLLMPricing(sourceUrl);
  if (sha !== meta.source_sha) {
    throw new Error(
      `--verify: upstream SHA changed (vendored ${meta.source_sha.slice(0, 8)} → upstream ${sha.slice(0, 8)})`,
    );
  }
  return { sha };
}

function parseArgs(argv) {
  /** @type {{ verify: boolean, outDir: string | null }} */
  const out = { verify: false, outDir: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--verify") {
      out.verify = true;
    } else if (arg === "--out-dir") {
      const next = argv[i + 1];
      if (!next) throw new Error("--out-dir requires a path argument");
      out.outDir = next;
      i++;
    } else if (arg.startsWith("--out-dir=")) {
      out.outDir = arg.slice("--out-dir=".length);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function printHelp() {
  // The script doc-comment above is the canonical reference; this helper
  // prints a short usage summary for CLI users.
  process.stdout.write(
    [
      "Usage: node fetch-litellm-pricing.mjs [--verify] [--out-dir <path>]",
      "",
      "  --verify           Re-fetch upstream, compare SHA against meta file.",
      "  --out-dir <path>   Output directory (default: this script's dir).",
      "",
    ].join("\n"),
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const defaultDir = path.dirname(fileURLToPath(import.meta.url));
  const outDir = args.outDir ?? defaultDir;

  if (args.verify) {
    const { sha } = await runVerify({ outDir });
    process.stdout.write(
      `Verified: upstream SHA matches vendored meta (${sha.slice(0, 12)}…)\n`,
    );
    return;
  }

  const { jsonPath, sha, rowCount } = await runFetchAndWrite({ outDir });
  process.stdout.write(
    `Wrote ${rowCount} rows to ${jsonPath} (sha256 ${sha.slice(0, 12)}…)\n`,
  );
}

const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === new URL(`file:${process.argv[1]}`).href;

if (isMainModule) {
  main().catch((error) => {
    process.stderr.write(
      `fetch-litellm-pricing: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
