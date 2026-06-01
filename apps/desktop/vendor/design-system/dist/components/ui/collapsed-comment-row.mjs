import React from "react";
"use client";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/collapsed-comment-row.tsx
import { CheckIcon, ChevronDown } from "lucide-react";
function CollapsedCommentRow({
  author,
  title,
  onExpand,
  avatar,
  statusLabel = "Comment resolved"
}) {
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-accent/50",
      onClick: onExpand,
      type: "button"
    },
    /* @__PURE__ */ React.createElement("span", { className: "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success" }, /* @__PURE__ */ React.createElement(CheckIcon, { "aria-hidden": true, className: "h-3 w-3" })),
    avatar,
    /* @__PURE__ */ React.createElement("span", { className: "min-w-0 flex-1 truncate text-muted-foreground text-xs" }, /* @__PURE__ */ React.createElement("span", { className: "font-medium text-foreground" }, statusLabel), " \xB7", " ", /* @__PURE__ */ React.createElement("span", { className: "font-medium text-foreground" }, author), title ? ` \xB7 ${title}` : ""),
    /* @__PURE__ */ React.createElement(ChevronDown, { className: "h-3.5 w-3.5 shrink-0 text-muted-foreground" })
  );
}
export {
  CollapsedCommentRow
};
//# sourceMappingURL=collapsed-comment-row.mjs.map