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

export type ListenerProbe =
  | { kind: "pid"; pid: number }
  | { kind: "none" }
  | { kind: "unavailable" };

export function resolveListenerProbe(
  status: number | null,
  error: Error | null | undefined,
  stdout: string,
): ListenerProbe {
  if (error) {
    return { kind: "unavailable" };
  }
  if (status !== 0) {
    return { kind: "none" };
  }
  const pid = parseListenerPid(stdout);
  return pid == null ? { kind: "none" } : { kind: "pid", pid };
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
  listenerProbe: ListenerProbe,
  expectedPid: number,
  childRunning: boolean,
  sidecarHealthy: boolean,
): boolean {
  if (!childRunning || !sidecarHealthy) {
    return false;
  }
  if (listenerProbe.kind === "unavailable") {
    return true;
  }
  return listenerProbe.kind === "pid" && listenerProbe.pid === expectedPid;
}
