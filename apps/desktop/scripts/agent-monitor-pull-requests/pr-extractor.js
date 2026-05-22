/**
 * @file pr-extractor.js
 * @description Bridges the session importer to the command-gated PR parsers.
 * `extractPullRequestsFromSession(session)` re-reads the session's raw JSONL
 * (the normalized session object the importer builds drops tool_result output,
 * which command-gating needs) and returns PR-record drafts ready for
 * `upsertPullRequest`.
 *
 * Every record is keyed to the importer's canonical session id
 * (`session.sessionId`, which is `sessions.id`) so a PR row FK-joins to its
 * session row even for Codex, where the in-file session id differs from the
 * transcript filename.
 *
 * Part of CLOSEDLOOP engineer GitHub activity capture (FEA-1226). Materialized
 * into the generated tree as server/lib/pr-extractor.js.
 */
"use strict";

const fs = require("fs");
const {
  createSessionParserState,
  parseSessionLine,
  safeParseLine,
} = require("./pr-parsers");

/**
 * @param {object} session - the normalized session object from parseSessionFile;
 *   must carry `sessionId` and `sourceLogPath` (added to parseSessionFile's
 *   return by build-agent-monitor.mjs).
 * @returns {object[]} PR-record drafts for upsertPullRequest.
 */
function extractPullRequestsFromSession(session) {
  if (!session || typeof session.sourceLogPath !== "string") {
    return [];
  }
  let text;
  try {
    text = fs.readFileSync(session.sourceLogPath, "utf8");
  } catch {
    return []; // file vanished / unreadable — best-effort, never throws
  }

  const canonicalSessionId =
    typeof session.sessionId === "string" ? session.sessionId : null;
  const state = createSessionParserState();
  const observedAt = new Date().toISOString();
  const out = [];

  for (const line of text.split("\n")) {
    if (!line) continue;
    const parsed = safeParseLine(line);
    if (!parsed) continue;
    for (const ev of parseSessionLine(parsed, canonicalSessionId || "", state)) {
      out.push({
        prUrl: ev.prUrl,
        prNumber: ev.prNumber,
        repoFullName: ev.repoFullName,
        branchName: ev.branchName,
        headSha: ev.headSha,
        harness: ev.harness,
        // Pin to the importer's session id so pull_requests.session_id joins
        // to sessions.id; the parser's per-line id is only a fallback.
        externalSessionId: canonicalSessionId || ev.externalSessionId,
        observedAt,
      });
    }
  }
  return out;
}

module.exports = { extractPullRequestsFromSession };
