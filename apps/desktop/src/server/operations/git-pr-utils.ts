import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getShellEnv } from "../shell-path.js";
import { getResolvedGhPath } from "./symphony-loop.js";

const execFileAsync = promisify(execFile);

const PR_NUMBER_REGEX = /\/pull\/(\d+)/;

export interface CreatePullRequestOptions {
  worktreeDir: string;
  baseBranch?: string;
  title: string;
  body: string;
  repoPath: string;
}

export interface CreatePullRequestResult {
  prUrl: string;
  prNumber: number;
}

function parsePrNumberFromUrl(url: string): number | null {
  const match = PR_NUMBER_REGEX.exec(url.trim());
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function getPrViewResult(cwd: string): Promise<CreatePullRequestResult> {
  const env = await getShellEnv();
  const { stdout } = await execFileAsync(
    getResolvedGhPath(),
    ["pr", "view", "--json", "url,number"],
    { cwd, encoding: "utf-8", env }
  );
  const parsed = JSON.parse(stdout.trim()) as { url?: string; number?: number };
  if (!parsed.url || !parsed.number) {
    throw new Error("Could not parse PR url and number from gh pr view output");
  }
  return { prUrl: parsed.url, prNumber: parsed.number };
}

/**
 * Creates a GitHub pull request using the gh CLI.
 *
 * - Looks for a PR template at opts.worktreeDir/.github/pull_request_template.md
 *   and prepends it to the body if found.
 * - Writes the final body to a temp file, passes it via --body-file to gh.
 * - Handles "already exists" by fetching PR info via gh pr view.
 * - Cleans up the temp body file after use.
 */
export async function createPullRequest(
  opts: CreatePullRequestOptions
): Promise<CreatePullRequestResult> {
  const { worktreeDir, baseBranch, title, repoPath } = opts;
  let { body } = opts;

  // Check for PR template and prepend if found
  const templatePath = path.join(worktreeDir, ".github", "pull_request_template.md");
  if (existsSync(templatePath)) {
    const template = readFileSync(templatePath, "utf-8");
    body = template.trim()
      ? `${template.trim()}\n\n${body}`.trim()
      : body;
  }

  // Write body to temp file
  const workDir = path.join(worktreeDir, ".closedloop-ai", "work");
  mkdirSync(workDir, { recursive: true });
  const bodyFile = path.join(workDir, "pr-body.md");
  writeFileSync(bodyFile, body, "utf-8");

  try {
    const env = await getShellEnv();
    const args = [
      "pr",
      "create",
      "--title",
      title,
      "--body-file",
      bodyFile,
    ];
    if (baseBranch) {
      args.splice(2, 0, "--base", baseBranch);
    }

    let createOutput: string;
    try {
      const { stdout } = await execFileAsync(getResolvedGhPath(), args, {
        cwd: repoPath,
        encoding: "utf-8",
        env,
      });
      createOutput = stdout.trim();
    } catch (error) {
      const message = String(error);
      if (message.includes("already exists")) {
        return getPrViewResult(repoPath);
      }
      throw error;
    }

    // Parse PR URL and number from stdout
    const prNumber = parsePrNumberFromUrl(createOutput);
    if (prNumber !== null) {
      return { prUrl: createOutput, prNumber };
    }

    // stdout may not be a URL (e.g. extra messaging), fall back to gh pr view
    return getPrViewResult(repoPath);
  } finally {
    // Clean up temp body file
    try {
      if (existsSync(bodyFile)) {
        unlinkSync(bodyFile);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
