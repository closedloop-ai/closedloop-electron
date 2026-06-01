var React = require("react");
"use strict";
"use client";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// components/ui/collapsed-comment-row.tsx
var collapsed_comment_row_exports = {};
__export(collapsed_comment_row_exports, {
  CollapsedCommentRow: () => CollapsedCommentRow
});
module.exports = __toCommonJS(collapsed_comment_row_exports);
var import_lucide_react = require("lucide-react");
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
    /* @__PURE__ */ React.createElement("span", { className: "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success" }, /* @__PURE__ */ React.createElement(import_lucide_react.CheckIcon, { "aria-hidden": true, className: "h-3 w-3" })),
    avatar,
    /* @__PURE__ */ React.createElement("span", { className: "min-w-0 flex-1 truncate text-muted-foreground text-xs" }, /* @__PURE__ */ React.createElement("span", { className: "font-medium text-foreground" }, statusLabel), " \xB7", " ", /* @__PURE__ */ React.createElement("span", { className: "font-medium text-foreground" }, author), title ? ` \xB7 ${title}` : ""),
    /* @__PURE__ */ React.createElement(import_lucide_react.ChevronDown, { className: "h-3.5 w-3.5 shrink-0 text-muted-foreground" })
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CollapsedCommentRow
});
//# sourceMappingURL=collapsed-comment-row.js.map