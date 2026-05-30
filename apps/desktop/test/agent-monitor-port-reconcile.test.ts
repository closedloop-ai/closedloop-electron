/**
 * Tests for the Agent Monitor port detect-and-reconcile decision logic.
 *
 * Focuses on the pure, side-effect-free surface that drives the three-guard
 * kill decision (FEA-1450):
 *   - classifyHolder: foreign / orphan / live truth table
 *   - parseFirstPid + parsePsLine: tolerant parsing of lsof/ps output
 *   - PID-file round-trip + tolerance of missing/garbage files
 *
 * The kill action and Electron dialog are intentionally not exercised here —
 * they are injected/side-effecting and covered by manual local verification.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import {
  classifyHolder,
  parseFirstPid,
  parsePsLine,
  readRecordedPid,
  removeSidecarPidFile,
  writeSidecarPidFile,
  type HolderClass,
  type PortHolder,
} from "../src/main/agent-monitor-port-reconcile.js";

const SELF_UID = 501;
const OURS = "/Applications/Electron --some-flag /opt/app/agent-monitor/server/index.js";

interface ClassifyCase {
  label: string;
  holder: PortHolder;
  recordedPid: number | null;
  expected: HolderClass;
}

const classifyCases: ClassifyCase[] = [
  {
    label: "different uid → foreign (never touch another user's process)",
    holder: { pid: 200, uid: 0, ppid: 1, command: OURS },
    recordedPid: null,
    expected: "foreign",
  },
  {
    label: "our uid but unrelated command → foreign",
    holder: { pid: 200, uid: SELF_UID, ppid: 1, command: "/usr/bin/python -m http.server 4820" },
    recordedPid: null,
    expected: "foreign",
  },
  {
    label: "ours + PPID 1 → orphan (parent died in an unclean exit)",
    holder: { pid: 200, uid: SELF_UID, ppid: 1, command: OURS },
    recordedPid: null,
    expected: "orphan",
  },
  {
    label: "ours + pid matches PID file → orphan (high-confidence prior process)",
    holder: { pid: 200, uid: SELF_UID, ppid: 9999, command: OURS },
    recordedPid: 200,
    expected: "orphan",
  },
  {
    label: "ours + live parent + no PID-file match → live (another instance)",
    holder: { pid: 200, uid: SELF_UID, ppid: 9999, command: OURS },
    recordedPid: 7,
    expected: "live",
  },
  {
    label: "ours + live parent + null PID file → live",
    holder: { pid: 200, uid: SELF_UID, ppid: 4242, command: OURS },
    recordedPid: null,
    expected: "live",
  },
];

describe("classifyHolder", () => {
  for (const { label, holder, expected } of classifyCases) {
    test(label, () => {
      assert.equal(classifyHolder(holder, SELF_UID), expected);
    });
  }
});

describe("parseFirstPid", () => {
  test("single pid", () => {
    assert.equal(parseFirstPid("4821\n"), 4821);
  });
  test("first of several listeners", () => {
    assert.equal(parseFirstPid("4821\n4822\n"), 4821);
  });
  test("empty output (no holder) → null", () => {
    assert.equal(parseFirstPid(""), null);
  });
  test("garbage → null", () => {
    assert.equal(parseFirstPid("not-a-pid\n"), null);
  });
});

describe("parsePsLine", () => {
  test("well-formed uid/ppid/command", () => {
    const holder = parsePsLine(200, "  501     1 /opt/app/agent-monitor/server/index.js\n");
    assert.deepEqual(holder, {
      pid: 200,
      uid: 501,
      ppid: 1,
      command: "/opt/app/agent-monitor/server/index.js",
    });
  });
  test("command with embedded spaces is preserved", () => {
    const holder = parsePsLine(200, "501 1 /Applications/My App/Electron a b c");
    assert.equal(holder?.command, "/Applications/My App/Electron a b c");
  });
  test("empty/malformed output → null", () => {
    assert.equal(parsePsLine(200, ""), null);
    assert.equal(parsePsLine(200, "garbage"), null);
  });
  test("trailing/extra lines are ignored (first data line wins)", () => {
    const holder = parsePsLine(200, "501 1 /opt/app/agent-monitor/server/index.js\n\n");
    assert.equal(holder?.command, "/opt/app/agent-monitor/server/index.js");
  });
});

describe("PID file helpers", () => {
  let dir: string;
  let pidFile: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "fea1450-"));
    pidFile = path.join(dir, "nested", "sidecar.pid");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("write then read round-trips the pid (and creates parent dir)", () => {
    writeSidecarPidFile(pidFile, 4821);
    assert.equal(readRecordedPid(pidFile), 4821);
  });

  test("missing file → null (no throw)", () => {
    assert.equal(readRecordedPid(pidFile), null);
  });

  test("garbage contents → null", () => {
    writeFileSync(pidFile.replace("nested/", ""), "not-a-pid", "utf-8");
    assert.equal(readRecordedPid(pidFile.replace("nested/", "")), null);
  });

  test("remove is idempotent and clears the recorded pid", () => {
    writeSidecarPidFile(pidFile, 4821);
    removeSidecarPidFile(pidFile);
    assert.equal(readRecordedPid(pidFile), null);
    // Second removal must not throw on an already-absent file.
    removeSidecarPidFile(pidFile);
  });
});
