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

// components/ui/priority-badge.tsx
var priority_badge_exports = {};
__export(priority_badge_exports, {
  PriorityBadge: () => PriorityBadge,
  priorityBadgeVariants: () => priorityBadgeVariants,
  priorityLabels: () => priorityLabels
});
module.exports = __toCommonJS(priority_badge_exports);
var React = __toESM(require("react"));
var import_class_variance_authority = require("class-variance-authority");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/priority-badge.tsx
var priorityBadgeVariants = (0, import_class_variance_authority.cva)(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors",
  {
    variants: {
      priority: {
        LOW: "border-info/30 bg-info/10 text-info-foreground",
        MEDIUM: "border-warning/30 bg-warning/10 text-warning-foreground",
        HIGH: "border-destructive/30 bg-destructive/10 text-destructive-foreground",
        URGENT: "border-destructive/50 bg-destructive/20 text-destructive-foreground font-semibold"
      }
    },
    defaultVariants: {
      priority: "MEDIUM"
    }
  }
);
var priorityLabels = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent"
};
function PriorityBadge({ priority, className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "span",
    {
      "data-slot": "priority-badge",
      className: cn(priorityBadgeVariants({ priority }), className),
      ...props
    },
    priorityLabels[priority]
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PriorityBadge,
  priorityBadgeVariants,
  priorityLabels
});
//# sourceMappingURL=priority-badge.js.map