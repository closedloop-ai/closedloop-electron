import fs from "node:fs/promises";
import path from "node:path";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import { DirectoryNotAllowedError } from "../security.js";
import { assertRepoAllowed, findFirstExisting, resolveWorktreeDir } from "./symphony-utils.js";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

export function registerSymphonyAttachmentsRoutes(
  dispatcher: OperationDispatcher,
  getAllowedDirectories: () => string[]
): void {
  dispatcher.register(
    "GET",
    "/api/engineer/symphony/attachments/:ticketId/*attachmentPath",
    async (context) => {
      const ticketId = context.params.ticketId;
      const repoPath = context.query.get("repo");
      const attachmentPath = context.params.attachmentPath;

      if (!repoPath) {
        json(context, 400, { error: "repo parameter is required" });
        return;
      }

      if (!attachmentPath) {
        json(context, 400, { error: "attachment path is required" });
        return;
      }

      let expandedRepoPath: string;
      try {
        expandedRepoPath = assertRepoAllowed(repoPath, getAllowedDirectories());
      } catch (error) {
        if (error instanceof DirectoryNotAllowedError) {
          json(context, 403, { error: "directory not allowed" });
          return;
        }
        throw error;
      }

      const worktreeDir = resolveWorktreeDir(expandedRepoPath, ticketId);
      const normalizedAttachmentPath = attachmentPath
        .split("/")
        .map((segment) => decodeURIComponent(segment))
        .join(path.sep);

      // Resolve both candidate absolute paths and verify neither escapes its attachments dir
      const newAttachmentsDir = path.resolve(path.join(worktreeDir, ".closedloop-ai", "work", "attachments"));
      const oldAttachmentsDir = path.resolve(path.join(worktreeDir, ".claude", "work", "attachments"));
      const newFilePath = path.resolve(newAttachmentsDir, normalizedAttachmentPath);
      const oldFilePath = path.resolve(oldAttachmentsDir, normalizedAttachmentPath);

      const isUnderDir = (file: string, dir: string): boolean => {
        const prefix = dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`;
        return file === dir || file.startsWith(prefix);
      };

      if (!isUnderDir(newFilePath, newAttachmentsDir) && !isUnderDir(oldFilePath, oldAttachmentsDir)) {
        json(context, 403, { error: "Invalid path" });
        return;
      }

      const filePath = findFirstExisting(newFilePath, oldFilePath);
      if (!filePath) {
        json(context, 404, { error: "File not found" });
        return;
      }

      try {
        const fileBuffer = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

        context.response.statusCode = 200;
        context.response.setHeader("Content-Type", contentType);
        context.response.setHeader("Cache-Control", "public, max-age=3600");
        context.response.end(fileBuffer);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        json(context, 500, { error: message });
      }
    }
  );
}

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}
