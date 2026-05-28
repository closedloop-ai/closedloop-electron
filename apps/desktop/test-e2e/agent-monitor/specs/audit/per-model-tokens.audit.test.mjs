// Per-model token-total audit: for each model in
// /api/workflows.modelDelegation.tokensByModel, assert every numeric column
// matches the DB sum for that model.
//
// High bug-finding probability: any drift in baseline_* handling, missing
// model bucketing, or stale aggregation cache would surface here.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import {
  makeTempDbPath,
  reseedPacksAndSkills,
  seedFixtureDb,
} from "../../helpers/seed-fixture-db.mjs";
import { launchSidecar } from "../../helpers/launch-sidecar.mjs";
import {
  tokens_by_model_map,
  tool_counts_map,
  tool_transitions_map,
  subagent_effectiveness_map,
  workflow_main_models_map,
} from "../../inventory/oracles.mjs";
import { compareNumeric, openDb } from "../../inventory/audit-runner.mjs";

let sidecar;
let cleanupDb;
let baseUrl;
let dbPath;

before(async () => {
  const tmp = makeTempDbPath();
  cleanupDb = tmp.cleanup;
  dbPath = tmp.dbPath;
  seedFixtureDb(dbPath);
  sidecar = await launchSidecar({ dbPath });
  reseedPacksAndSkills(dbPath);
  baseUrl = sidecar.baseUrl;
});

after(async () => {
  await sidecar.stop();
  cleanupDb();
});

test("/api/workflows.modelDelegation.tokensByModel — per-model token sums match oracle", async () => {
  const res = await fetch(`${baseUrl}/api/workflows`);
  const body = await res.json();
  const apiList = body.modelDelegation?.tokensByModel || [];
  assert.ok(Array.isArray(apiList), "expected tokensByModel to be an array");

  const db = openDb(dbPath);
  try {
    const oracleMap = tokens_by_model_map(db);
    const failures = [];

    // Every API model row should match the oracle.
    for (const apiRow of apiList) {
      const model = apiRow.model;
      const oracle = oracleMap[model];
      if (!oracle) {
        failures.push({
          model,
          reason: `API returned model "${model}" but DB has no token_usage rows for it`,
        });
        continue;
      }
      for (const field of [
        "input_tokens",
        "output_tokens",
        "cache_read_tokens",
        "cache_write_tokens",
      ]) {
        const apiVal = Number(apiRow[field] ?? 0);
        const oracleVal = Number(oracle[field] ?? 0);
        const cmp = compareNumeric(apiVal, oracleVal);
        if (!cmp.ok) {
          failures.push({
            model,
            field,
            apiVal,
            oracleVal,
            reason: cmp.reason,
          });
        }
      }
    }

    // Every oracle model should appear in the API.
    const apiModels = new Set(apiList.map((r) => r.model));
    for (const model of Object.keys(oracleMap)) {
      if (!apiModels.has(model)) {
        failures.push({
          model,
          reason: `DB has token_usage for model "${model}" but API omits it from tokensByModel`,
        });
      }
    }

    assert.deepEqual(
      failures,
      [],
      `tokensByModel disagreements:\n` +
        failures
          .map((f) =>
            f.field
              ? `  ${f.model}.${f.field}: api=${f.apiVal} oracle=${f.oracleVal}`
              : `  ${f.model}: ${f.reason}`,
          )
          .join("\n"),
    );
  } finally {
    db.close();
  }
});

test("/api/workflows.modelDelegation.mainModels — per-model main-agent counts match oracle", async () => {
  const res = await fetch(`${baseUrl}/api/workflows`);
  const body = await res.json();
  const apiList = body.modelDelegation?.mainModels || [];

  const db = openDb(dbPath);
  try {
    const oracleMap = workflow_main_models_map(db);
    const failures = [];

    for (const apiRow of apiList) {
      const model = apiRow.model;
      const oracle = oracleMap[model];
      if (!oracle) {
        failures.push({
          model,
          reason: `API returned mainModels row for "${model}" but DB has no main agents in sessions of that model`,
        });
        continue;
      }
      for (const field of ["agent_count", "session_count"]) {
        const apiVal = Number(apiRow[field] ?? 0);
        const oracleVal = Number(oracle[field] ?? 0);
        const cmp = compareNumeric(apiVal, oracleVal);
        if (!cmp.ok) {
          failures.push({
            model,
            field,
            apiVal,
            oracleVal,
            reason: cmp.reason,
          });
        }
      }
    }

    const apiModels = new Set(apiList.map((r) => r.model));
    for (const model of Object.keys(oracleMap)) {
      if (!apiModels.has(model)) {
        failures.push({
          model,
          reason: `DB has main agents in sessions of model "${model}" but API omits it`,
        });
      }
    }

    assert.deepEqual(
      failures,
      [],
      `mainModels disagreements:\n` +
        failures
          .map((f) =>
            f.field
              ? `  ${f.model}.${f.field}: api=${f.apiVal} oracle=${f.oracleVal}`
              : `  ${f.model}: ${f.reason}`,
          )
          .join("\n"),
    );
  } finally {
    db.close();
  }
});

test("/api/workflows.effectiveness — per-subagent-type counts match oracle", async () => {
  const res = await fetch(`${baseUrl}/api/workflows`);
  const body = await res.json();
  const apiList = body.effectiveness || [];

  const db = openDb(dbPath);
  try {
    const oracleMap = subagent_effectiveness_map(db);
    const failures = [];

    for (const apiRow of apiList) {
      const type = apiRow.subagent_type;
      const oracle = oracleMap[type];
      if (!oracle) {
        failures.push({
          type,
          reason: `API returned effectiveness row for "${type}" but DB has no subagents of that type`,
        });
        continue;
      }
      for (const field of ["total", "completed", "errors", "sessions"]) {
        const apiVal = Number(apiRow[field] ?? 0);
        const oracleVal = Number(oracle[field] ?? 0);
        const cmp = compareNumeric(apiVal, oracleVal);
        if (!cmp.ok) {
          failures.push({ type, field, apiVal, oracleVal, reason: cmp.reason });
        }
      }
    }

    const apiTypes = new Set(apiList.map((r) => r.subagent_type));
    for (const type of Object.keys(oracleMap)) {
      if (!apiTypes.has(type)) {
        failures.push({
          type,
          reason: `DB has subagents of type "${type}" but API omits it from effectiveness`,
        });
      }
    }

    assert.deepEqual(
      failures,
      [],
      `subagent effectiveness disagreements:\n` +
        failures
          .map((f) =>
            f.field
              ? `  ${f.type}.${f.field}: api=${f.apiVal} oracle=${f.oracleVal}`
              : `  ${f.type}: ${f.reason}`,
          )
          .join("\n"),
    );
  } finally {
    db.close();
  }
});

test("/api/workflows.toolFlow.transitions — tool transitions match oracle (PreToolUse → PreToolUse)", { todo: "expected failure — FEA-1421 (Pre→Post pairs counted as fake transitions)" }, async () => {
  const res = await fetch(`${baseUrl}/api/workflows`);
  const body = await res.json();
  const apiList = body.toolFlow?.transitions || [];

  const db = openDb(dbPath);
  try {
    const oracleMap = tool_transitions_map(db);
    const failures = [];

    for (const apiRow of apiList) {
      const key = `${apiRow.source}||${apiRow.target}`;
      const apiVal = Number(apiRow.value ?? 0);
      const oracleVal = Number(oracleMap[key] ?? 0);
      const cmp = compareNumeric(apiVal, oracleVal);
      if (!cmp.ok) {
        failures.push({
          transition: key,
          apiVal,
          oracleVal,
          reason: cmp.reason,
        });
      }
    }

    // Self-loop check: PreToolUse(X) immediately followed by PostToolUse(X)
    // would create a (X, X) self-loop in the broken upstream query. Real
    // transitions almost never have X→X without an intermediate.
    const selfLoops = apiList.filter(
      (r) => r.source === r.target && Number(r.value) > 0,
    );

    assert.deepEqual(
      failures,
      [],
      `tool transitions disagreements:\n` +
        failures
          .map((f) => `  ${f.transition}: api=${f.apiVal} oracle=${f.oracleVal}`)
          .join("\n") +
        (selfLoops.length
          ? `\n\n  Note: API also returned ${selfLoops.length} (X, X) self-loops, which are usually the symptom — PostToolUse(X) being treated as the "next tool" after PreToolUse(X). Self-loops: ${selfLoops.map((r) => r.source).join(", ")}`
          : ""),
    );
  } finally {
    db.close();
  }
});

test("/api/workflows.toolFlow.toolCounts — per-tool counts match oracle", { todo: "expected failure — FEA-1420 (Pre+Post double-counted)" }, async () => {
  const res = await fetch(`${baseUrl}/api/workflows`);
  const body = await res.json();
  const apiList = body.toolFlow?.toolCounts || [];

  const db = openDb(dbPath);
  try {
    const oracleMap = tool_counts_map(db);
    const failures = [];

    for (const apiRow of apiList) {
      const tool = apiRow.tool_name;
      const apiCount = Number(apiRow.count ?? 0);
      const oracleCount = Number(oracleMap[tool] ?? 0);
      const cmp = compareNumeric(apiCount, oracleCount);
      if (!cmp.ok) {
        failures.push({
          tool,
          apiCount,
          oracleCount,
          reason: cmp.reason,
        });
      }
    }

    const apiTools = new Set(apiList.map((r) => r.tool_name));
    for (const tool of Object.keys(oracleMap)) {
      if (!apiTools.has(tool)) {
        failures.push({
          tool,
          reason: `DB has PreToolUse events for "${tool}" but API omits it from toolCounts`,
        });
      }
    }

    assert.deepEqual(
      failures,
      [],
      `toolCounts disagreements:\n` +
        failures
          .map((f) =>
            f.apiCount !== undefined
              ? `  ${f.tool}: api=${f.apiCount} oracle=${f.oracleCount}`
              : `  ${f.tool}: ${f.reason}`,
          )
          .join("\n"),
    );
  } finally {
    db.close();
  }
});
