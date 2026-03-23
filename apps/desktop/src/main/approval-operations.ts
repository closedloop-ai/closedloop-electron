/**
 * Electron-free operation catalog for the approval system.
 * Extracted from app.ts so it can be imported in plain Node tests.
 */

export const SUPPORTED_OPERATION_IDS = [
  "symphony_launch",
  "symphony_loop",
  "symphony_loop_kill",
  "symphony_plan_loop",
  "symphony_status",
  "symphony_kill",
  "symphony_chat",
  "symphony_comment_chat",
  "symphony_commit_message",
  "symphony_sessions",
  "symphony_plan",
  "symphony_judges",
  "symphony_logs",
  "symphony_chat_history",
  "terminal_chat",
  "ticket_chat",
  "run_viewer_chat",
  "codex_review",
  "codex_argue",
  "git_action",
  "git_pr",
  "health_check",
  "repos_config",
  "deploy",
  "learnings",
  "filesystem"
] as const;

export type OperationId = (typeof SUPPORTED_OPERATION_IDS)[number];

export function resolveOperationId(pathname: string): string | null {
  if (!pathname.startsWith("/api/engineer/")) {
    return null;
  }

  if (pathname === "/api/engineer/symphony/launch") {
    return "symphony_launch";
  }
  if (pathname === "/api/engineer/symphony/loop") {
    return "symphony_loop";
  }
  if (pathname === "/api/engineer/symphony/loop/kill") {
    return "symphony_loop_kill";
  }
  if (pathname.startsWith("/api/engineer/symphony/plan-loop/")) {
    return "symphony_plan_loop";
  }
  if (pathname.startsWith("/api/engineer/symphony/status/")) {
    return "symphony_status";
  }
  if (pathname === "/api/engineer/symphony/kill") {
    return "symphony_kill";
  }
  if (pathname.startsWith("/api/engineer/symphony/chat/")) {
    return "symphony_chat";
  }
  if (pathname.startsWith("/api/engineer/symphony/comment-chat/")) {
    return "symphony_comment_chat";
  }
  if (pathname.startsWith("/api/engineer/symphony/commit-message/")) {
    return "symphony_commit_message";
  }
  if (pathname === "/api/engineer/symphony/sessions") {
    return "symphony_sessions";
  }
  if (pathname.startsWith("/api/engineer/symphony/plan/")) {
    return "symphony_plan";
  }
  if (pathname.startsWith("/api/engineer/symphony/judges/")) {
    return "symphony_judges";
  }
  if (pathname.startsWith("/api/engineer/symphony/logs/")) {
    return "symphony_logs";
  }
  if (pathname.startsWith("/api/engineer/symphony/chat-history/")) {
    return "symphony_chat_history";
  }
  if (pathname.startsWith("/api/engineer/symphony/pending-learnings")) {
    return "learnings";
  }
  if (pathname.startsWith("/api/engineer/symphony/process-learnings")) {
    return "learnings";
  }
  if (pathname.startsWith("/api/engineer/symphony/process-all-learnings")) {
    return "learnings";
  }
  if (pathname.startsWith("/api/engineer/symphony/extract-learnings")) {
    return "learnings";
  }
  if (pathname.startsWith("/api/engineer/symphony/learnings-status/")) {
    return "learnings";
  }
  if (pathname === "/api/engineer/symphony/record-learning-use") {
    return "learnings";
  }
  if (pathname === "/api/engineer/terminal-chat") {
    return "terminal_chat";
  }
  if (pathname === "/api/engineer/ticket-chat") {
    return "ticket_chat";
  }
  if (pathname === "/api/engineer/run-viewer-chat") {
    return "run_viewer_chat";
  }
  if (pathname.startsWith("/api/engineer/codex/argue/")) {
    return "codex_argue";
  }
  if (pathname.startsWith("/api/engineer/codex/")) {
    return "codex_review";
  }
  if (pathname.startsWith("/api/engineer/git/pr") || pathname === "/api/engineer/git/user") {
    return "git_pr";
  }
  if (pathname.startsWith("/api/engineer/git")) {
    return "git_action";
  }
  if (pathname === "/api/engineer/health-check") {
    return "health_check";
  }
  if (pathname === "/api/engineer/repos") {
    return "repos_config";
  }
  if (pathname.startsWith("/api/engineer/deploy")) {
    return "deploy";
  }
  if (pathname === "/api/engineer/learnings") {
    return "learnings";
  }
  if (pathname.startsWith("/api/engineer/work-directory/")) {
    return "filesystem";
  }
  if (pathname.startsWith("/api/engineer/symphony/sessions/")) {
    return "symphony_sessions";
  }
  if (
    pathname === "/api/engineer/directories" ||
    pathname === "/api/engineer/files/search" ||
    pathname.startsWith("/api/engineer/run-viewer-extract")
  ) {
    return "filesystem";
  }

  return null;
}
