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

// components/ui/comment-thread.tsx
var comment_thread_exports = {};
__export(comment_thread_exports, {
  CommentThreadAnchorPreview: () => CommentThreadAnchorPreview,
  CommentThreadBanner: () => CommentThreadBanner,
  CommentThreadCard: () => CommentThreadCard,
  CommentThreadCollapseFooter: () => CommentThreadCollapseFooter,
  CommentThreadHeader: () => CommentThreadHeader,
  CommentThreadMain: () => CommentThreadMain,
  CommentThreadReplies: () => CommentThreadReplies,
  CommentThreadReplyRow: () => CommentThreadReplyRow
});
module.exports = __toCommonJS(comment_thread_exports);

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/comment-thread.tsx
var import_lucide_react = require("lucide-react");
function CommentThreadCard({
  children,
  className,
  interactive = false,
  onClick,
  onKeyDown,
  selected = false,
  tabIndex,
  testId,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "relative min-w-0 overflow-hidden rounded-lg border border-border",
        interactive && (selected ? "bg-accent transition-colors" : "transition-colors hover:bg-accent/50"),
        className
      ),
      "data-testid": testId,
      onClick,
      onKeyDown,
      tabIndex,
      ...props
    },
    children
  );
}
function CommentThreadMain({
  actions,
  avatar,
  className,
  content
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "flex w-full min-w-0 items-start gap-2 px-3 py-3 sm:gap-3 sm:px-4 sm:py-4",
        className
      )
    },
    avatar,
    /* @__PURE__ */ React.createElement("div", { className: "flex w-0 flex-1 flex-col gap-2" }, content),
    actions
  );
}
function CommentThreadHeader({
  author,
  className,
  metadata
}) {
  return /* @__PURE__ */ React.createElement("div", { className: cn("flex flex-wrap items-center gap-2", className) }, author, metadata);
}
function CommentThreadReplies({
  children,
  className,
  label,
  showDivider = false
}) {
  return /* @__PURE__ */ React.createElement(React.Fragment, null, label ? /* @__PURE__ */ React.createElement("div", { className: "mx-4 flex items-center gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "h-px flex-1 bg-border" }), /* @__PURE__ */ React.createElement("span", { className: "font-medium text-muted-foreground text-xs" }, label), /* @__PURE__ */ React.createElement("div", { className: "h-px flex-1 bg-border" })) : null, /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        showDivider ? "space-y-3 border-border border-t bg-muted/20 px-3 py-3 sm:px-4" : "space-y-3 border-muted border-l-2 bg-muted/20 px-3 py-3 pb-4 pl-8 sm:px-4 sm:pl-12",
        className
      )
    },
    children
  ));
}
function CommentThreadReplyRow({
  actions,
  avatar,
  body,
  header
}) {
  return /* @__PURE__ */ React.createElement("div", { className: "flex items-start gap-2.5" }, avatar, /* @__PURE__ */ React.createElement("div", { className: "flex min-w-0 flex-1 flex-col gap-1" }, header, body), actions);
}
function CommentThreadBanner({
  children,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "flex items-center justify-end border-b bg-muted/40 px-3 py-1",
        className
      )
    },
    children
  );
}
function CommentThreadAnchorPreview({
  children,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    "blockquote",
    {
      className: cn(
        "whitespace-pre-wrap border-b bg-muted/40 px-3 py-2 text-muted-foreground text-xs italic",
        className
      )
    },
    children
  );
}
function CommentThreadCollapseFooter({
  className,
  label,
  onClick,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      className: cn(
        "flex w-full items-center justify-center gap-1.5 border-border border-t bg-muted/10 py-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground",
        className
      ),
      onClick,
      type: "button",
      ...props
    },
    /* @__PURE__ */ React.createElement(import_lucide_react.ChevronDown, { className: "h-3.5 w-3.5 rotate-180" }),
    label
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CommentThreadAnchorPreview,
  CommentThreadBanner,
  CommentThreadCard,
  CommentThreadCollapseFooter,
  CommentThreadHeader,
  CommentThreadMain,
  CommentThreadReplies,
  CommentThreadReplyRow
});
//# sourceMappingURL=comment-thread.js.map