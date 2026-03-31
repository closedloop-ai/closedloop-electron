import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const LOOP_AUTH_TOKEN_FILE = ".closedloop-loop-auth-token";

export function getLoopAuthTokenPath(claudeWorkDir: string): string {
  return path.join(claudeWorkDir, LOOP_AUTH_TOKEN_FILE);
}

export function persistLoopAuthToken(
  claudeWorkDir: string,
  loopAuthToken: string,
): void {
  writeFileSync(getLoopAuthTokenPath(claudeWorkDir), loopAuthToken, {
    mode: 0o600,
  });
}

export function readPersistedLoopAuthToken(
  claudeWorkDir?: string,
): string | null {
  if (!claudeWorkDir) {
    return null;
  }

  const tokenPath = getLoopAuthTokenPath(claudeWorkDir);
  if (!existsSync(tokenPath)) {
    return null;
  }

  try {
    const token = readFileSync(tokenPath, "utf-8").trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}
