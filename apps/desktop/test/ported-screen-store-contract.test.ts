import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  getPack,
  listPacks,
  listSkillInvocations,
  listSkills,
} from "../src/main/packs/pack-store.js";
import {
  getPlanVersions,
  listPlans,
} from "../src/main/plans/plan-store.js";
import {
  getPrStats,
  listPrSessions,
  listPullRequests,
} from "../src/main/pull-requests/pr-store.js";

type QueryResult<T extends Record<string, unknown>> = { rows: T[] };
type StubDb = {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
};

function rows<T extends Record<string, unknown>>(items: Record<string, unknown>[]): QueryResult<T> {
  return { rows: items as T[] };
}

function createPackDb(): StubDb {
  return {
    async query<T extends Record<string, unknown>>(sql: string): Promise<QueryResult<T>> {
      if (sql.includes("FROM agent_packs p")) {
        return rows<T>([
          {
            pack_id: "demo-pack",
            version: "1.0.0",
            harnesses: "claude,codex",
            install_count: 2,
            first_detected_at: "2026-06-08T12:00:00.000Z",
            last_seen_at: "2026-06-08T13:00:00.000Z",
            skill_count: 2,
          },
        ]);
      }
      if (sql.includes("FROM agent_packs") && sql.includes("install_path")) {
        return rows<T>([
          {
            pack_id: "demo-pack",
            harness: "claude",
            install_path: "/tmp/demo",
            install_kind: "directory",
            source_url: "https://example.test/demo",
            version: "1.0.0",
            detected_at: "2026-06-08T12:00:00.000Z",
            last_seen_at: "2026-06-08T13:00:00.000Z",
          },
        ]);
      }
      if (sql.includes("FROM project_pack_associations")) {
        return rows<T>([
          {
            project_path: "/tmp/project",
            pack_id: "demo-pack",
            detected_at: "2026-06-08T12:00:00.000Z",
            last_seen_at: "2026-06-08T13:00:00.000Z",
          },
        ]);
      }
      if (sql.includes("FROM skills")) {
        return rows<T>([
          {
            skill_id: "skill-1",
            pack_id: "demo-pack",
            harness: "claude",
            install_path: "/tmp/demo",
            name: "demo-skill",
            version: "1.0.0",
            description: "Demo skill",
            source_url: null,
            detected_at: "2026-06-08T12:00:00.000Z",
            last_seen_at: "2026-06-08T13:00:00.000Z",
            invocation_count: 4,
            last_invoked_at: "2026-06-08T14:00:00.000Z",
          },
        ]);
      }
      if (sql.includes("FROM events e")) {
        return rows<T>([
          {
            event_id: "event-1",
            session_id: "session-1",
            created_at: "2026-06-08T13:00:00.000Z",
            summary: null,
            data: null,
            session_name: "Session",
            session_cwd: "/tmp/project",
            session_harness: "claude",
            session_model: "sonnet",
          },
        ]);
      }
      return rows<T>([]);
    },
  };
}

function createPlanDb(): StubDb {
  return {
    async query<T extends Record<string, unknown>>(sql: string): Promise<QueryResult<T>> {
      if (sql.includes("FROM plans p")) {
        return rows<T>([
          {
            id: "plan-1",
            plan_key: "plan-key",
            title: "Plan",
            status: "captured",
            source: "test",
            capture_method: "extractor",
            harness: "claude",
            created_from_session_id: "session-1",
            file_path: "/tmp/plan.md",
            source_log_path: "/tmp/session.jsonl",
            needs_confirmation: true,
            confidence: 0.8,
            created_at: "2026-06-08T12:00:00.000Z",
            updated_at: "2026-06-08T13:00:00.000Z",
            latest_content: "# Plan",
            version_count: 2,
          },
        ]);
      }
      if (sql.includes("FROM plan_versions")) {
        return rows<T>([
          {
            id: "version-1",
            plan_id: "plan-1",
            version_number: 1,
            content_markdown: "# Plan",
            content_sha256: "abc",
            author_type: "agent",
            capture_method: "extractor",
            created_at: "2026-06-08T12:00:00.000Z",
          },
        ]);
      }
      return rows<T>([]);
    },
  };
}

function createPrDb(): StubDb {
  return {
    async query<T extends Record<string, unknown>>(sql: string): Promise<QueryResult<T>> {
      if (sql.includes("COUNT(*)::int AS total_prs")) {
        return rows<T>([{ total_prs: 3, total_repos: 2, total_sessions: 1 }]);
      }
      if (sql.includes("FROM pull_requests pr")) {
        return rows<T>([
          {
            session_id: "session-1",
            session_name: "Session",
            session_started_at: "2026-06-08T12:00:00.000Z",
            session_cwd: "/tmp/project",
            pr_count: 1,
            last_pr_at: "2026-06-08T13:00:00.000Z",
            harness: "claude",
          },
        ]);
      }
      if (sql.includes("FROM pull_requests")) {
        return rows<T>([
          {
            id: "pr-1",
            session_id: "session-1",
            pr_url: "https://github.com/acme/repo/pull/12",
            pr_number: 12,
            repo_full_name: "acme/repo",
            branch_name: "feature",
            head_sha: "abc",
            title: "Demo PR",
            harness: "claude",
            observed_at: "2026-06-08T13:00:00.000Z",
            created_at: "2026-06-08T12:30:00.000Z",
          },
        ]);
      }
      return rows<T>([]);
    },
  };
}

describe("ported screen store contracts", () => {
  test("pack and skill stores return renderer DTO arrays", async () => {
    const db = createPackDb();
    const packs = await listPacks(db);
    const pack = await getPack(db, "demo-pack");
    const skills = await listSkills(db);
    const invocations = await listSkillInvocations(db, "demo-skill");

    assert.deepEqual(packs[0]?.harnesses, ["claude", "codex"]);
    assert.equal(pack?.packId, "demo-pack");
    assert.equal(pack?.installs[0]?.installPath, "/tmp/demo");
    assert.equal(pack?.skills[0]?.skillId, "skill-1");
    assert.equal(pack?.associations[0]?.projectPath, "/tmp/project");
    assert.equal(skills[0]?.skillId, "skill-1");
    assert.equal(skills[0]?.invocationCount, 4);
    assert.equal(invocations[0]?.eventId, "event-1");
    assert.equal(invocations[0]?.sessionName, "Session");
  });

  test("plan store returns renderer DTO fields", async () => {
    const db = createPlanDb();
    const plans = await listPlans(db);
    const versions = await getPlanVersions(db, "plan-1");

    assert.equal(plans[0]?.captureMethod, "extractor");
    assert.equal(plans[0]?.sessionId, "session-1");
    assert.equal(plans[0]?.latestContent, "# Plan");
    assert.equal(plans[0]?.versionCount, 2);
    assert.equal(versions[0]?.planId, "plan-1");
    assert.equal(versions[0]?.versionNumber, 1);
  });

  test("pull request store returns renderer DTO fields", async () => {
    const db = createPrDb();
    const stats = await getPrStats(db);
    const prs = await listPullRequests(db);
    const sessions = await listPrSessions(db);

    assert.deepEqual(stats, { totalPrs: 3, sessionsWithPrs: 1, repos: 2 });
    assert.equal(prs[0]?.prUrl, "https://github.com/acme/repo/pull/12");
    assert.equal(prs[0]?.repoFullName, "acme/repo");
    assert.equal(sessions[0]?.sessionId, "session-1");
    assert.equal(sessions[0]?.prs[0]?.prNumber, 12);
  });
});
