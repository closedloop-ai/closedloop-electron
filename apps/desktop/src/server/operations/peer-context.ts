import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Resolved peer worktree metadata. Each peer is a primary-cloned-from-origin
 * worktree on a `symphony/...` branch namespace, mounted alongside the primary
 * for the agent to read. The shape mirrors the ECS helper at
 * `containers/claude-runner/lib/peer-context.mjs` so the two runtimes write
 * identical `peer-repos.json` manifests and identical mount-path footers.
 */
export type PeerWorktreeRef = {
  fullName: string;
  branch: string;
  localPath: string;
};

/**
 * Minimal shape of a provisioned peer worktree entry. Structurally typed so
 * this module does not import the full `AdditionalWorktreeEntry` from
 * `symphony-loop.ts` (which would risk circular imports and pull operational
 * code into this leaf helper).
 */
type PeerWorktreeEntryShape = {
  dir: string;
  fullName?: string;
  baseBranch?: string;
};

/**
 * Convert provisioned peer-worktree entries to the agent-facing
 * `PeerWorktreeRef` shape. Every provisioned entry is included — a peer
 * supplied via `localRepoPath` only (no inferable origin `fullName`) would
 * otherwise be cloned/checked-out but never advertised as `--add-dir` to
 * Claude. When `fullName` is missing we fall back to the worktree directory
 * basename so the manifest and mount-paths footer always carry a stable
 * label and the agent's `--add-dir` count matches the provisioned count.
 */
export function toPeerWorktreeRefs(
  entries: ReadonlyArray<PeerWorktreeEntryShape>
): PeerWorktreeRef[] {
  return entries.map((w) => ({
    fullName:
      typeof w.fullName === "string" && w.fullName.length > 0
        ? w.fullName
        : path.basename(w.dir),
    branch: w.baseBranch ?? "main",
    localPath: w.dir,
  }));
}

/**
 * Write `peer-repos.json` into the loop's context dir. The manifest gives the
 * agent a structured view of each peer mount so it can reference them by name
 * and absolute path. No-op when no peers are present. The caller decides
 * whether to surface write errors — typical pattern is best-effort + log.
 */
export async function writePeerReposManifest(
  contextDir: string,
  peers: ReadonlyArray<PeerWorktreeRef>
): Promise<boolean> {
  if (peers.length === 0) {
    return false;
  }
  await fs.mkdir(contextDir, { recursive: true });
  await fs.writeFile(
    path.join(contextDir, "peer-repos.json"),
    JSON.stringify(
      {
        peers: peers.map((p) => ({
          fullName: p.fullName,
          branch: p.branch,
          localPath: p.localPath,
        })),
      },
      null,
      2
    )
  );
  return true;
}

/**
 * Build the "## Mounted paths" prompt footer enumerating each peer by
 * `fullName` + `branch` + absolute mount path. Empty when no peers — callers
 * append unconditionally and rely on the empty-string return for the no-peer
 * case to keep the prompt byte-identical to today.
 */
export function buildMountPathsFooter(
  peers: ReadonlyArray<PeerWorktreeRef>
): string {
  if (peers.length === 0) {
    return "";
  }
  const lines = peers.map(
    (p) => `- \`${p.fullName}\` @ \`${p.branch}\` → \`${p.localPath}\``
  );
  return `\n\n## Mounted paths\n\n${lines.join("\n")}\n`;
}
