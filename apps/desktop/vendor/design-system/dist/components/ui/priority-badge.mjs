"use client";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/priority-badge.tsx
import * as React from "react";
import { cva } from "class-variance-authority";
var priorityBadgeVariants = cva(
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
export {
  PriorityBadge,
  priorityBadgeVariants,
  priorityLabels
};
//# sourceMappingURL=priority-badge.mjs.map