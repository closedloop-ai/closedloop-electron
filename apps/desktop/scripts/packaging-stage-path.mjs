import os from "node:os";
import path from "node:path";

const STAGE_ROOT_NAME = "closedloop-electron-packaging-stage";

export function getPackagingStageRoot() {
  const stageId = process.env.GITHUB_RUN_ID ?? "local";
  return path.join(os.tmpdir(), STAGE_ROOT_NAME, stageId);
}

export function getPackagingStageAppDir() {
  return path.join(getPackagingStageRoot(), "app");
}
