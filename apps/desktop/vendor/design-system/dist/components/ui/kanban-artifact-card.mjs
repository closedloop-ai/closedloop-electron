import React from "react";
"use client";
import {
  KanbanCardFrame
} from "../../chunk-EYIDES2P.mjs";
import "../../chunk-4VG3CUB2.mjs";
import {
  Chip
} from "../../chunk-TX5PRGT7.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/kanban-artifact-card.tsx
function KanbanArtifactCard({
  title,
  subtitle,
  icon,
  kindLabel,
  priorityLabel,
  statusLabel,
  assigneeLabel,
  updatedLabel,
  active = false,
  variant = "default",
  className,
  onClick
}) {
  const content = /* @__PURE__ */ React.createElement(
    KanbanCardFrame,
    {
      active,
      className: cn(
        "rounded-xl p-3 shadow-sm hover:border-border",
        CARD_VARIANT_CLASS_NAMES[variant],
        className
      )
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-start justify-between gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex min-w-0 items-start gap-3" }, icon ? /* @__PURE__ */ React.createElement("div", { className: "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/12 text-amber-400" }, icon) : null, /* @__PURE__ */ React.createElement("div", { className: "min-w-0 space-y-1" }, /* @__PURE__ */ React.createElement("p", { className: "truncate font-medium text-sm" }, title), subtitle ? /* @__PURE__ */ React.createElement("p", { className: "truncate font-mono text-[11px] text-muted-foreground" }, subtitle) : null)), kindLabel ? /* @__PURE__ */ React.createElement(Chip, { size: "sm", variant: "outline" }, kindLabel) : null),
    priorityLabel || statusLabel ? /* @__PURE__ */ React.createElement("div", { className: "mt-3 flex flex-wrap items-center gap-2" }, priorityLabel ? /* @__PURE__ */ React.createElement(Chip, { size: "sm", variant: "accent" }, priorityLabel) : null, statusLabel ? /* @__PURE__ */ React.createElement(Chip, { size: "sm", variant: "outline" }, statusLabel) : null) : null,
    assigneeLabel || updatedLabel ? /* @__PURE__ */ React.createElement("div", { className: "mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground" }, /* @__PURE__ */ React.createElement("span", { className: "truncate" }, assigneeLabel), /* @__PURE__ */ React.createElement("span", { className: "shrink-0" }, updatedLabel)) : null
  );
  if (!onClick) {
    return content;
  }
  return /* @__PURE__ */ React.createElement("button", { className: "block w-full text-left", onClick, type: "button" }, content);
}
var CARD_VARIANT_CLASS_NAMES = {
  default: "",
  lane: "rounded-md shadow-none hover:bg-accent/50",
  "drag-preview": "cursor-grabbing rounded-md shadow-lg"
};
export {
  KanbanArtifactCard
};
//# sourceMappingURL=kanban-artifact-card.mjs.map