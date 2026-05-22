export function parseListenerPid(stdout: string): number | null {
  const line = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  if (!line) {
    return null;
  }
  const pid = Number(line);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function isAgentMonitorCommand(
  command: string,
  expectedEntryFile: string,
): boolean {
  if (command.trim().length === 0) {
    return false;
  }
  return (
    command.includes("/agent-monitor/server/index.js") &&
    (command.includes(expectedEntryFile) ||
      command.includes("ClosedLoop.app/Contents/MacOS/Electron"))
  );
}

export function ownsHealthyListener(
  listenerPid: number | null,
  expectedPid: number,
  childRunning: boolean,
  sidecarHealthy: boolean,
): boolean {
  return (
    listenerPid === expectedPid &&
    childRunning &&
    sidecarHealthy
  );
}
