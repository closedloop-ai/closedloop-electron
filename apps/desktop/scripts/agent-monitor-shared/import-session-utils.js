const RECENT_SESSION_ACTIVITY_THRESHOLD_MS = 10 * 60 * 1000;

function isSessionRecentlyActive(session, now = Date.now()) {
  return (
    session != null &&
    Number.isFinite(session.fileModifiedAt) &&
    now - session.fileModifiedAt < RECENT_SESSION_ACTIVITY_THRESHOLD_MS
  );
}

function reactivateImportedSession(dbModule, session, now = Date.now()) {
  if (!isSessionRecentlyActive(session, now)) return false;

  const row = dbModule.stmts.getSession.get(session.sessionId);
  if (!row) return false;
  if (row.status === "active" && row.ended_at == null) return false;

  dbModule.stmts.reactivateSession.run(session.sessionId);
  try {
    dbModule.stmts.clearSessionAwaitingInput.run(session.sessionId);
  } catch {
    /* non-fatal */
  }

  const mainAgentId = `${session.sessionId}-main`;
  const mainAgent = dbModule.stmts.getAgent.get(mainAgentId);
  if (mainAgent) {
    dbModule.db
      .prepare(
        "UPDATE agents SET status = 'waiting', ended_at = NULL, current_tool = NULL, awaiting_input_since = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
      )
      .run(mainAgentId);
  }

  return true;
}

module.exports = {
  RECENT_SESSION_ACTIVITY_THRESHOLD_MS,
  isSessionRecentlyActive,
  reactivateImportedSession,
};
