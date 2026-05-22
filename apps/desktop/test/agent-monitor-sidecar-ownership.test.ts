import assert from "node:assert/strict";
import test from "node:test";

import {
  isAgentMonitorCommand,
  ownsHealthyListener,
  parseListenerPid,
} from "../src/main/agent-monitor-sidecar-ownership.js";

test("parseListenerPid returns the first valid listener pid", () => {
  assert.equal(parseListenerPid("81392\n"), 81392);
  assert.equal(parseListenerPid("\n 61151 \n81392\n"), 61151);
});

test("parseListenerPid rejects blank or invalid lsof output", () => {
  assert.equal(parseListenerPid(""), null);
  assert.equal(parseListenerPid("\n\n"), null);
  assert.equal(parseListenerPid("not-a-pid\n"), null);
  assert.equal(parseListenerPid("0\n"), null);
});

test("isAgentMonitorCommand matches packaged or generated sidecars only", () => {
  const expectedEntryFile =
    "/private/tmp/closedloop-electron-main-fix/apps/desktop/.generated/agent-monitor/server/index.js";
  assert.equal(
    isAgentMonitorCommand(
      `/Users/me/node_modules/.pnpm/electron/dist/ClosedLoop.app/Contents/MacOS/Electron ${expectedEntryFile}`,
      expectedEntryFile,
    ),
    true,
  );
  assert.equal(
    isAgentMonitorCommand(
      "/Applications/ClosedLoop.app/Contents/MacOS/Electron /Applications/ClosedLoop.app/Contents/Resources/agent-monitor/server/index.js",
      expectedEntryFile,
    ),
    true,
  );
  assert.equal(
    isAgentMonitorCommand(
      "/usr/local/bin/node /tmp/some-other-server/index.js",
      expectedEntryFile,
    ),
    false,
  );
  assert.equal(isAgentMonitorCommand("", expectedEntryFile), false);
});

test("ownsHealthyListener only accepts the pid this app launched", () => {
  assert.equal(ownsHealthyListener(123, 123, true, true), true);
  assert.equal(ownsHealthyListener(999, 123, true, true), false);
  assert.equal(ownsHealthyListener(123, 123, false, true), false);
  assert.equal(ownsHealthyListener(123, 123, true, false), false);
  assert.equal(ownsHealthyListener(null, 123, true, true), false);
});
