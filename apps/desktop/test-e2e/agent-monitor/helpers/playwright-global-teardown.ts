import { readFileSync, rmSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export default async function globalTeardown() {
  const statePath = process.env.E2E_SIDECAR_STATE;
  if (!statePath || !existsSync(statePath)) return;
  try {
    const { pid, dbPath } = JSON.parse(readFileSync(statePath, "utf8"));
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
        await new Promise((r) => setTimeout(r, 500));
        try {
          process.kill(pid, 0);
          // still alive — escalate
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      } catch {
        /* already gone */
      }
    }
    if (dbPath) rmSync(dirname(dbPath), { recursive: true, force: true });
  } finally {
    rmSync(statePath, { force: true });
  }
}
