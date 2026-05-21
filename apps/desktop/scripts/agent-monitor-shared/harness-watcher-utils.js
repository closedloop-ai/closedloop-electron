/**
 * Shared watcher helpers for non-Claude harnesses.
 */

function broadcastHarnessRows(dbModule, broadcast, harness) {
  try {
    const sessionRows = dbModule.db
      .prepare("SELECT * FROM sessions WHERE harness = ?")
      .all(harness);
    for (const row of sessionRows) {
      broadcast("session_updated", row);
    }

    const agentRows = dbModule.db
      .prepare(
        `SELECT a.*
         FROM agents a
         JOIN sessions s ON s.id = a.session_id
         WHERE s.harness = ?`,
      )
      .all(harness);
    for (const row of agentRows) {
      broadcast("agent_updated", row);
    }
  } catch {
    /* non-fatal */
  }
}

module.exports = { broadcastHarnessRows };
