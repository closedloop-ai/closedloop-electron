import React from "react";
"use client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../../chunk-M266NC23.mjs";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import {
  toast
} from "../../chunk-VGUI7V4Z.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/comment-action-menu.tsx
import {
  CheckCheck,
  Copy,
  Ellipsis,
  MessageSquareIcon,
  Pencil,
  Trash2
} from "lucide-react";
function CommentActionMenu({
  canEdit = true,
  canDelete = true,
  isResolvePending = false,
  onEditToggle,
  onDelete,
  onChatAboutThis,
  onResolveAction,
  resolveLabel,
  copyValue,
  copySuccessMessage = "Copied link",
  chatLabel = "Chat About This"
}) {
  const hasCopyValue = typeof copyValue === "string" && copyValue.length > 0;
  function copyLink() {
    if (!hasCopyValue || !globalThis.navigator.clipboard?.writeText) {
      return;
    }
    globalThis.navigator.clipboard.writeText(copyValue).then(() => toast.success(copySuccessMessage)).catch(() => {
    });
  }
  return /* @__PURE__ */ React.createElement(DropdownMenu, null, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(
    Button,
    {
      "aria-label": "More actions",
      className: "h-7 w-7 shrink-0 p-0",
      "data-comment-control": "true",
      onClick: (event) => event.stopPropagation(),
      size: "icon",
      variant: "ghost"
    },
    /* @__PURE__ */ React.createElement(Ellipsis, { className: "h-4 w-4" })
  )), /* @__PURE__ */ React.createElement(DropdownMenuContent, { align: "end" }, onResolveAction && resolveLabel ? /* @__PURE__ */ React.createElement(
    DropdownMenuItem,
    {
      disabled: isResolvePending,
      onSelect: onResolveAction
    },
    /* @__PURE__ */ React.createElement(CheckCheck, { className: "mr-2 h-3.5 w-3.5" }),
    resolveLabel
  ) : null, /* @__PURE__ */ React.createElement(DropdownMenuItem, { disabled: !canEdit, onSelect: onEditToggle }, /* @__PURE__ */ React.createElement(Pencil, { className: "mr-2 h-3.5 w-3.5" }), "Edit"), onChatAboutThis ? /* @__PURE__ */ React.createElement(DropdownMenuItem, { onSelect: onChatAboutThis }, /* @__PURE__ */ React.createElement(MessageSquareIcon, { className: "mr-2 h-3.5 w-3.5" }), chatLabel) : null, hasCopyValue ? /* @__PURE__ */ React.createElement(DropdownMenuItem, { onSelect: copyLink }, /* @__PURE__ */ React.createElement(Copy, { className: "mr-2 h-3.5 w-3.5" }), "Copy Link") : null, /* @__PURE__ */ React.createElement(DropdownMenuItem, { disabled: !canDelete, onSelect: onDelete }, /* @__PURE__ */ React.createElement(Trash2, { className: "mr-2 h-3.5 w-3.5" }), "Delete")));
}
export {
  CommentActionMenu
};
//# sourceMappingURL=comment-action-menu.mjs.map