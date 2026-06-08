import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  getCatalog,
  listCatalog,
  listHistory,
  listInstallRuns,
} from "../src/main/packs/catalog-store.js";

type QueryResult<T extends Record<string, unknown>> = { rows: T[] };

type StubDb = {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
};

function createStubDb(): StubDb {
  return {
    async query<T extends Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      if (sql.includes("FROM pack_catalog_history")) {
        return {
          rows: [
            {
              fetched_at: "2026-06-08T12:00:00.000Z",
              stars: 12,
              forks: 3,
            },
          ] as T[],
        };
      }
      if (sql.includes("FROM pack_install_runs")) {
        return {
          rows: [
            {
              id: 7,
              pack_id: params?.[0] ?? "demo-pack",
              harness: "claude",
              action: "install",
              command: "echo install",
              exit_code: 0,
              started_at: "2026-06-08T12:00:00.000Z",
              ended_at: "2026-06-08T12:01:00.000Z",
              stdout_tail: "ok",
              stderr_tail: null,
            },
          ] as T[],
        };
      }
      return {
        rows: [
          {
            pack_id: "demo-pack",
            display_name: "Demo Pack",
            category: "tools",
            github_url: "https://github.com/acme/demo-pack",
            marketplace_url: null,
            description: "Seed description",
            description_live: "Live description",
            harnesses: ["claude", "codex"],
            install_commands: { claude: "echo install" },
            uninstall_commands: { claude: "echo uninstall" },
            install_notes: "notes",
            placeholder_reason: null,
            verified: true,
            readme_excerpt: "readme",
            readme_fetched_at: null,
            stars: 12,
            forks: 3,
            last_release: "v1.0.0",
            last_fetched_at: null,
            seed_version: 4,
            pin_order: 1,
            contents: { type: "none" },
            contents_cache: [{ name: "demo", type: "skill" }],
            contents_fetched_at: null,
            detection_patterns: ["demo"],
            harness_agnostic: false,
            project_scoped: true,
            single_install: false,
            post_install: { message: "done" },
            installed_harnesses: "claude",
            installed_skill_count: 2,
            uninstalled_at: null,
          },
        ] as T[],
      };
    },
  };
}

describe("catalog-store renderer contract", () => {
  test("listCatalog maps raw DB rows into CatalogEntry DTO fields", async () => {
    const entries = await listCatalog(createStubDb());

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.packId, "demo-pack");
    assert.equal(entries[0]?.displayName, "Demo Pack");
    assert.deepEqual(entries[0]?.harnesses, ["claude", "codex"]);
    assert.deepEqual(entries[0]?.installedHarnesses, ["claude"]);
    assert.equal(entries[0]?.skillCount, 2);
    assert.equal(entries[0]?.usageCount, 0);
    assert.equal(entries[0]?.projectScoped, true);
    assert.equal(entries[0]?.installCommands?.claude, "echo install");
    assert.equal(entries[0]?.uninstallCommands?.claude, "echo uninstall");
    assert.equal(entries[0]?.contents?.type, "none");
    assert.equal(entries[0]?.contentsCache?.[0]?.name, "demo");
    assert.deepEqual(entries[0]?.history, []);
  });

  test("getCatalog and listHistory return camelCase history fields", async () => {
    const entry = await getCatalog(createStubDb(), "demo-pack");
    const history = await listHistory(createStubDb(), "demo-pack");

    assert.equal(entry?.history[0]?.fetchedAt, "2026-06-08T12:00:00.000Z");
    assert.equal(entry?.history[0]?.stars, 12);
    assert.deepEqual(history, entry?.history);
  });

  test("listInstallRuns maps raw DB rows into InstallRunRecord DTO fields", async () => {
    const runs = await listInstallRuns(createStubDb(), { pack_id: "demo-pack" });

    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.packId, "demo-pack");
    assert.equal(runs[0]?.exitCode, 0);
    assert.equal(runs[0]?.startedAt, "2026-06-08T12:00:00.000Z");
    assert.equal(runs[0]?.stdoutTail, "ok");
  });
});
