#!/usr/bin/env node

/**
 * @file codex-hook-handler.js
 * @description Codex CLI hook handler (FEA-1503; first-party, moved out of the
 * deleted vendor scripts tree). Mirrors the Claude `hook-handler.js` but posts
 * to the Codex-owned listener route so the in-process listener stamps the
 * session row with `harness='codex'` without trusting payload data.
 *
 * Zero-dependency, plain CommonJS, fail-silent — a hook must never block a Codex
 * turn. Codex calls this once per lifecycle event (SessionStart, UserPromptSubmit,
 * PreToolUse, PostToolUse, Stop) with the event name as the single argv arg. The
 * port + path + payload envelope must stay in sync with the in-process listener
 * (src/main/agent-monitor-listener.ts); both ship in the same build.
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

  const data =
    parsedData && typeof parsedData === "object" && !Array.isArray(parsedData)
      ? parsedData
      : { raw: parsedData };

  const payload = JSON.stringify({ hook_type: hookType, data });

  const req = http.request(
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/hooks/codex/event",
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

// Safety net timeout — Codex's default hook timeout is around 5s.
setTimeout(() => process.exit(0), 5000);
