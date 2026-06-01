var React = require("react");
"use strict";
"use client";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// components/ui/kanban-artifact-card.tsx
var kanban_artifact_card_exports = {};
__export(kanban_artifact_card_exports, {
  KanbanArtifactCard: () => KanbanArtifactCard
});
module.exports = __toCommonJS(kanban_artifact_card_exports);

// components/ui/chip.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/chip.tsx
var chipVariants = (0, import_class_variance_authority.cva)(
  "inline-flex max-w-full items-center justify-center gap-1 rounded-full border font-medium whitespace-nowrap shrink-0 transition-[color,box-shadow,background-color] overflow-hidden [&>svg]:shrink-0 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-destructive/25 bg-destructive/12 text-destructive",
        success: "border-success/25 bg-success/12 text-success",
        warning: "border-warning/30 bg-warning/14 text-warning-foreground",
        info: "border-info/25 bg-info/12 text-info",
        accent: "border-primary/20 bg-primary/10 text-primary",
        muted: "border-border bg-muted/70 text-muted-foreground",
        outline: "border-input-border bg-input text-foreground"
      },
      size: {
        sm: "h-5 px-1.5 text-[11px] [&>svg]:size-3",
        default: "h-6 px-2.5 text-xs [&>svg]:size-3.5",
        lg: "h-7 px-3 text-sm [&>svg]:size-4"
      },
      interactive: {
        true: "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none [a&]:hover:bg-muted [button&]:hover:bg-muted",
        false: ""
      }
    },
    defaultVariants: {
      variant: "muted",
      size: "default",
      interactive: false
    }
  }
);
function Chip({
  className,
  variant,
  size,
  interactive,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? import_radix_ui.Slot.Slot : "span";
  return /* @__PURE__ */ React2.createElement(
    Comp,
    {
      className: cn(chipVariants({ variant, size, interactive }), className),
      "data-slot": "chip",
      ...props
    }
  );
}

// components/ui/layout/kanban-board.tsx
var import_react = require("react");

// components/ui/scroll-area.tsx
var React3 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");

// components/ui/layout/kanban-board.tsx
function KanbanCardFrame({
  children,
  className,
  active = false
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "rounded-md border bg-card py-2 transition-colors",
        active && "border-primary/35 bg-primary/8 ring-1 ring-primary/20",
        className
      )
    },
    children
  );
}

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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KanbanArtifactCard
});
//# sourceMappingURL=kanban-artifact-card.js.map