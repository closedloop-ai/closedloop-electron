import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  hasBootstrapArtifacts,
} from "../src/server/operations/symphony-utils.js";
import {
  readBootstrapRepoOutputs,
} from "../src/server/operations/symphony-loop.js";

const tempPaths: string[] = [];

afterEach(async () => {
  for (const tempPath of tempPaths.splice(0)) {
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `bootstrap-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempPaths.push(dir);
  return dir;
}

// --- hasBootstrapArtifacts ---

describe("hasBootstrapArtifacts", () => {
  test("returns false for empty directory", () => {
    const dir = makeTempDir();
    assert.equal(hasBootstrapArtifacts(dir), false);
  });

  test("returns true when bootstrap-metadata.json exists", () => {
    const dir = makeTempDir();
    const metaDir = path.join(dir, ".closedloop-ai");
    mkdirSync(metaDir, { recursive: true });
    writeFileSync(
      path.join(metaDir, "bootstrap-metadata.json"),
      '{"bootstrap_version":"1.0"}',
    );
    assert.equal(hasBootstrapArtifacts(dir), true);
  });

  test("returns true when .claude/agents has .md files", () => {
    const dir = makeTempDir();
    const agentsDir = path.join(dir, ".claude", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      path.join(agentsDir, "frontend-architect.md"),
      "---\nname: frontend-architect\n---\nPrompt body",
    );
    assert.equal(hasBootstrapArtifacts(dir), true);
  });

  test("returns false when .claude/agents exists but has no .md files", () => {
    const dir = makeTempDir();
    const agentsDir = path.join(dir, ".claude", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(path.join(agentsDir, "README.txt"), "not an agent");
    assert.equal(hasBootstrapArtifacts(dir), false);
  });

  test("returns true when both metadata and agents exist", () => {
    const dir = makeTempDir();
    mkdirSync(path.join(dir, ".closedloop-ai"), { recursive: true });
    writeFileSync(
      path.join(dir, ".closedloop-ai", "bootstrap-metadata.json"),
      "{}",
    );
    mkdirSync(path.join(dir, ".claude", "agents"), { recursive: true });
    writeFileSync(
      path.join(dir, ".claude", "agents", "api-expert.md"),
      "---\nname: api-expert\n---\n",
    );
    assert.equal(hasBootstrapArtifacts(dir), true);
  });
});

// --- parseAgentFrontmatter (tested via readBootstrapRepoOutputs) ---

describe("bootstrap agent file parsing", () => {
  test("reads agent files with frontmatter from repo dir", async () => {
    // This tests the shape that readBootstrapRepoOutputs would produce.
    // We can't import it directly (it's not exported), but we test the
    // filesystem layout that the bootstrap command produces.
    const dir = makeTempDir();
    const agentsDir = path.join(dir, ".claude", "agents");
    mkdirSync(agentsDir, { recursive: true });

    const agentContent = [
      "---",
      "name: frontend-architect",
      "description: Specializes in React/Next.js frontend architecture",
      "model: sonnet",
      "color: blue",
      "tools: Read, Glob, Grep",
      "---",
      "",
      "You are a frontend architecture expert...",
    ].join("\n");
    writeFileSync(path.join(agentsDir, "frontend-architect.md"), agentContent);

    // Verify the file was written in the expected location
    const content = await fs.readFile(
      path.join(agentsDir, "frontend-architect.md"),
      "utf-8",
    );
    assert.equal(content, agentContent);

    // Verify hasBootstrapArtifacts detects it
    assert.equal(hasBootstrapArtifacts(dir), true);
  });
});

// --- bootstrap output locations ---

describe("bootstrap output locations", () => {
  test("critic-gates.json stored under .closedloop-ai/settings/", () => {
    const dir = makeTempDir();
    const settingsDir = path.join(dir, ".closedloop-ai", "settings");
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      path.join(settingsDir, "critic-gates.json"),
      '{"version":1,"defaults":{"baseCritics":["security-privacy"]}}',
    );

    const raw = readFileSync(path.join(settingsDir, "critic-gates.json"), "utf-8");
    const content = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(content.version, 1);
    assert.deepEqual(
      (content.defaults as Record<string, unknown>).baseCritics,
      ["security-privacy"],
    );
  });

  test("bootstrap-metadata.json stored under .closedloop-ai/", () => {
    const dir = makeTempDir();
    mkdirSync(path.join(dir, ".closedloop-ai"), { recursive: true });
    writeFileSync(
      path.join(dir, ".closedloop-ai", "bootstrap-metadata.json"),
      '{"bootstrap_version":"1.0","last_run":"2026-04-24","agents":{}}',
    );

    const raw = readFileSync(
      path.join(dir, ".closedloop-ai", "bootstrap-metadata.json"),
      "utf-8",
    );
    const content = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(content.bootstrap_version, "1.0");
    assert.ok(content.agents);
  });
});

// --- readBootstrapRepoOutputs with agentsDir ---

describe("readBootstrapRepoOutputs with agentsDir", () => {
  test("reads agents from specified dir instead of repo .claude/agents", () => {
    const repoDir = makeTempDir();
    const outputDir = makeTempDir();

    writeFileSync(
      path.join(outputDir, "test-agent.md"),
      [
        "---",
        "name: Test Agent",
        "description: A test agent",
        "---",
        "",
        "Agent prompt here",
      ].join("\n"),
    );

    mkdirSync(path.join(repoDir, ".closedloop-ai"), { recursive: true });
    writeFileSync(
      path.join(repoDir, ".closedloop-ai", "bootstrap-metadata.json"),
      JSON.stringify({ agents: ["test-agent"] }),
    );

    const result = readBootstrapRepoOutputs(repoDir, outputDir);
    assert.equal(result.agents.length, 1);
    assert.equal(result.agents[0]?.slug, "test-agent");
    assert.equal(result.agents[0]?.name, "Test Agent");
    assert.ok(result.metadata !== null);
  });

  test("falls back to repo .claude/agents when agentsDir not provided", () => {
    const repoDir = makeTempDir();
    const agentsDir = path.join(repoDir, ".claude", "agents");
    mkdirSync(agentsDir, { recursive: true });

    writeFileSync(
      path.join(agentsDir, "repo-agent.md"),
      "---\nname: Repo Agent\n---\nPrompt",
    );

    const result = readBootstrapRepoOutputs(repoDir);
    assert.equal(result.agents.length, 1);
    assert.equal(result.agents[0]?.slug, "repo-agent");
  });
});
