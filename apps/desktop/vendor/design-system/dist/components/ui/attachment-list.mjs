import React from "react";
"use client";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/attachment-list.tsx
import { DownloadIcon, FileIcon, Trash2Icon } from "lucide-react";
function AttachmentList({
  attachments,
  className,
  onDownload,
  onDelete,
  actionVisibility = "hover",
  emptyState = null
}) {
  if (attachments.length === 0) {
    return emptyState;
  }
  return /* @__PURE__ */ React.createElement("div", { className: cn("flex flex-wrap items-center gap-2", className) }, attachments.map((attachment) => /* @__PURE__ */ React.createElement(
    AttachmentChip,
    {
      actionVisibility,
      attachment,
      key: attachment.id,
      onDelete,
      onDownload
    }
  )));
}
function AttachmentChip({
  attachment,
  onDownload,
  onDelete,
  actionVisibility
}) {
  const actionClassName = actionVisibility === "always" ? void 0 : "opacity-0 group-hover:opacity-100";
  return /* @__PURE__ */ React.createElement("div", { className: "group flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-sm" }, attachment.previewUrl ? /* @__PURE__ */ React.createElement(
    "a",
    {
      className: "flex shrink-0 hover:opacity-90",
      href: attachment.previewUrl,
      rel: "noopener noreferrer",
      target: "_blank"
    },
    /* @__PURE__ */ React.createElement(
      "img",
      {
        alt: attachment.filename,
        className: "h-6 w-6 shrink-0 rounded object-cover",
        height: 24,
        src: attachment.previewUrl,
        width: 24
      }
    )
  ) : /* @__PURE__ */ React.createElement(FileIcon, { className: "h-4 w-4 shrink-0 text-muted-foreground" }), /* @__PURE__ */ React.createElement("span", { className: "max-w-[180px] truncate font-medium" }, attachment.filename), /* @__PURE__ */ React.createElement("span", { className: "shrink-0 text-muted-foreground text-xs" }, formatAttachmentSize(attachment.sizeBytes)), !attachment.previewUrl && onDownload ? /* @__PURE__ */ React.createElement(
    Button,
    {
      "aria-label": `Download ${attachment.filename}`,
      className: cn("h-6 w-6", actionClassName),
      onClick: () => onDownload(attachment),
      size: "icon",
      variant: "ghost"
    },
    /* @__PURE__ */ React.createElement(DownloadIcon, { className: "h-3.5 w-3.5" })
  ) : null, onDelete ? /* @__PURE__ */ React.createElement(
    Button,
    {
      "aria-label": `Delete ${attachment.filename}`,
      className: cn("h-6 w-6", actionClassName),
      onClick: () => onDelete(attachment),
      size: "icon",
      variant: "ghost"
    },
    /* @__PURE__ */ React.createElement(Trash2Icon, { className: "h-3.5 w-3.5" })
  ) : null);
}
function formatAttachmentSize(sizeBytes) {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.ceil(sizeBytes / 1024)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
export {
  AttachmentList
};
//# sourceMappingURL=attachment-list.mjs.map