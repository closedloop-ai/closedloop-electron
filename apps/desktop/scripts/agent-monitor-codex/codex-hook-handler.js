#!/usr/bin/env node

/**
 * @file codex-hook-handler.js
 * @description Codex CLI hook handler. Mirrors the upstream Claude
 * `hook-handler.js` (provider-agnostic, POSTs to `/api/hooks/event` on the
 * fixed agent-monitor sidecar port 4820) but injects `__provider: "codex"`
 * into the forwarded payload so the sidecar can stamp the session row with
 * `harness='codex'` via the existing `setSessionHarness` statement.
 *
 * Zero-dep, plain JS, fail-silent — same constraints as the upstream Claude
 * handler so a hook never blocks a Codex turn. Codex calls this once per
 * lifecycle event (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
 * Stop) with the event name as the single argv arg.
 *
 * Part of FEA-1444 (opt-in Codex hook ingestion).
 */

const http = require("http");

const hookType = process.argv[2] || "unknown";
const port = parseInt(process.env.CLAUDE_DASHBOARD_PORT || "4820", 10);

let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let parsedData;
  try {
    parsedData = JSON.parse(input);
  } catch {
    parsedData = { raw: input };
  }

  // Mark the payload as Codex-sourced so the sidecar's hooks-route patch
  // (build-agent-monitor.mjs `patchHooksRouteCodexHarness`) can stamp the
  // session's `harness` column. Field name is dunder-prefixed to make it
  // obvious this is a transport hint, not a Codex-native field.
  const enrichedData =
    parsedData && typeof parsedData === "object" && !Array.isArray(parsedData)
      ? { ...parsedData, __provider: "codex" }
      : { raw: parsedData, __provider: "codex" };

  const payload = JSON.stringify({
    hook_type: hookType,
    data: enrichedData,
  });

  const req = http.request(
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/hooks/event",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      timeout: 3000,
    },
    (res) => {
      res.resume();
      process.exit(0);
    },
  );

  req.on("error", () => process.exit(0));
  req.on("timeout", () => {
    req.destroy();
    process.exit(0);
  });

  req.write(payload);
  req.end();
});

// Safety net timeout — Codex's default hook timeout is around 5s; never let
// this process linger longer than that.
setTimeout(() => process.exit(0), 5000);
