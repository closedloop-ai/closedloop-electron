// Repro harness for FEA-1316.
//
// Spawns the generated agent-monitor server with tmp-dir harness homes for
// each non-Claude harness, pre-populates them with N synthetic Codex rollout
// files, then samples the child's RSS and CPU once per second.
//
// Pass criterion for "reproduced": RSS grows >= 50 MB over 5 minutes with no
// new sessions written, AND CPU sustains above 50%.
//
// Run: node apps/desktop/scripts/repro-agent-monitor.mjs --sessions=500 --duration=300

import { spawn, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");
const entry = join(desktopRoot, ".generated", "agent-monitor", "server", "index.js");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const SESSIONS = Number(args.sessions ?? 500);
const DURATION_S = Number(args.duration ?? 300);
const PORT = Number(args.port ?? 4830); // off the real 4820 so it can coexist
const HEAP_MB = Number(args.heap ?? 256);
const LABEL = args.label ?? "run";

// Set up tmp harness homes.
const root = mkdtempSync(join(tmpdir(), "fea1316-"));
const codexHome = join(root, "codex");
const cursorHome = join(root, "cursor");
const copilotHome = join(root, "copilot");
const opencodeHome = join(root, "opencode");
const userData = join(root, "userData");
const dbPath = join(userData, "agent-monitor", "dashboard.db");

const claudeEmpty = join(root, "claude-empty");
for (const p of [codexHome, cursorHome, copilotHome, opencodeHome, claudeEmpty, dirname(dbPath)]) {
  mkdirSync(p, { recursive: true });
}

// Pre-populate Codex sessions. Day-bucketed under sessions/YYYY/MM/DD/.
const codexSessions = join(codexHome, "sessions", "2026", "05", "20");
mkdirSync(codexSessions, { recursive: true });

// Realistic session size: a few dozen turns with chunky assistant content.
// 30+ response_item lines per file → ~30 KB on disk → 500 files = ~15 MB to
// re-parse every 5 s. Big enough that the leak is visible in CPU+RSS.
const TURNS_PER_SESSION = 40;
const ASSIST_BLOAT = "synthetic assistant reply with reasonable length text ".repeat(20);

function makeRolloutFile(sessionUuid) {
  const ts = "2026-05-20T08:00:00.000Z";
  const lines = [
    JSON.stringify({
      type: "session_meta",
      timestamp: ts,
      payload: {
        id: sessionUuid,
        session_id: sessionUuid,
        cwd: "/tmp/work",
        instructions: "synthetic",
        git: { branch: "main" },
      },
    }),
    JSON.stringify({
      type: "turn_context",
      timestamp: ts,
      payload: { model: "gpt-5-codex", reasoning_effort: "medium" },
    }),
  ];
  for (let t = 0; t < TURNS_PER_SESSION; t++) {
    lines.push(
      JSON.stringify({
        type: "response_item",
        timestamp: ts,
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: `turn ${t} prompt` }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: ts,
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: ASSIST_BLOAT }],
        },
      }),
    );
  }
  lines.push(
    JSON.stringify({
      type: "event_msg",
      timestamp: ts,
      payload: {
        type: "token_count",
        info: { total_token_usage: { input_tokens: 100, output_tokens: 2000 } },
      },
    }),
  );
  return lines.join("\n") + "\n";
}

for (let i = 0; i < SESSIONS; i++) {
  const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  writeFileSync(
    join(codexSessions, `rollout-2026-05-20T08-00-00-${uuid}.jsonl`),
    makeRolloutFile(uuid),
  );
}

console.log(`[harness] tmp root: ${root}`);
console.log(`[harness] codex sessions: ${SESSIONS} files`);
console.log(`[harness] duration: ${DURATION_S}s, heap cap: ${HEAP_MB} MB, port: ${PORT}`);

// Mirror the sidecar's NODE_PATH derivation so the generated server can require
// express/cors/etc. that are installed under the agent-dashboard package via pnpm.
function findAgentDashboardNodeModules() {
  const pnpm = join(desktopRoot, "..", "..", "node_modules", ".pnpm");
  const entries = execSync(`ls ${pnpm}`, { encoding: "utf8" }).split("\n");
  const match = entries.find((e) => e.startsWith("agent-dashboard@"));
  if (!match) throw new Error("agent-dashboard pnpm dir not found");
  return [
    join(pnpm, match, "node_modules", "agent-dashboard", "node_modules"),
    join(pnpm, match, "node_modules"),
  ];
}
const nodePath = findAgentDashboardNodeModules().join(":");

const env = {
  ...process.env,
  NODE_ENV: "production",
  NODE_OPTIONS: `--max-old-space-size=${HEAP_MB}`,
  NODE_PATH: nodePath,
  DASHBOARD_PORT: String(PORT),
  DASHBOARD_DB_PATH: dbPath,
  CCAM_VAPID_KEYS_PATH: join(userData, "agent-monitor", "data", "vapid-keys.json"),
  CCAM_ENABLE_RUN: "0",
  CCAM_AUTO_INSTALL_HOOKS: "0",
  // Point each harness at a tmp home so we don't touch real user data.
  CODEX_HOME: codexHome,
  CURSOR_HOME: cursorHome,
  COPILOT_HOME: copilotHome,
  OPENCODE_DATA_DIR: opencodeHome,
  // Empty Claude home so the Claude importer doesn't grab my real sessions.
  CLAUDE_HOME: join(root, "claude-empty"),
};

const child = spawn(process.execPath, [entry], {
  cwd: dirname(entry),
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  for (const line of chunk.split("\n")) {
    if (line.trim()) console.log(`[server] ${line}`);
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  for (const line of chunk.split("\n")) {
    if (line.trim()) console.log(`[server.err] ${line}`);
  }
});

const samples = [];
let firstSample = null;
let lastSample = null;

function sample() {
  if (!child.pid) return;
  try {
    const ps = execSync(`ps -o rss=,pcpu= -p ${child.pid}`, { encoding: "utf8" }).trim();
    const [rssKb, cpu] = ps.split(/\s+/).map(Number);
    const rssMb = rssKb / 1024;
    const row = { t: Date.now(), rssMb, cpu };
    samples.push(row);
    if (!firstSample) firstSample = row;
    lastSample = row;
    if (samples.length % 30 === 0 || samples.length <= 5) {
      console.log(
        `[harness.sample] t=${Math.round((row.t - samples[0].t) / 1000)}s rss=${rssMb.toFixed(1)}MB cpu=${cpu.toFixed(1)}%`,
      );
    }
  } catch {
    /* child exited */
  }
}

const tick = setInterval(sample, 1000);
sample();

let exited = false;
child.on("exit", (code, signal) => {
  exited = true;
  console.log(`[harness] child exited code=${code} signal=${signal}`);
});

setTimeout(() => {
  clearInterval(tick);
  if (!exited) child.kill("SIGTERM");

  const start = samples[5] ?? samples[0]; // skip warmup
  const end = samples[samples.length - 1];
  const rssDelta = end.rssMb - start.rssMb;
  const avgCpuLater = (() => {
    const tail = samples.slice(Math.floor(samples.length / 2));
    return tail.reduce((s, r) => s + r.cpu, 0) / tail.length;
  })();
  const peakRss = Math.max(...samples.map((s) => s.rssMb));

  console.log(`\n[harness.summary] label=${LABEL}`);
  console.log(`  samples: ${samples.length}`);
  console.log(`  rss start: ${start.rssMb.toFixed(1)} MB`);
  console.log(`  rss end:   ${end.rssMb.toFixed(1)} MB`);
  console.log(`  rss peak:  ${peakRss.toFixed(1)} MB`);
  console.log(`  rss delta: ${rssDelta >= 0 ? "+" : ""}${rssDelta.toFixed(1)} MB`);
  console.log(`  avg cpu (second half): ${avgCpuLater.toFixed(1)} %`);

  const reproduced =
    rssDelta >= 50 || avgCpuLater >= 50 || (exited && rssDelta >= 20);
  console.log(`  reproduced? ${reproduced ? "YES" : "no"}`);

  // Clean up tmp.
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }

  process.exit(reproduced ? 0 : 2);
}, DURATION_S * 1000 + 5000);
