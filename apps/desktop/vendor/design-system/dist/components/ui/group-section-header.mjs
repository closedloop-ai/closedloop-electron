import React from "react";
"use client";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/group-section-header.tsx
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
function GroupSectionHeader({
  icon,
  label,
  count,
  isOpen,
  onToggle,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      className: cn(
        "flex w-full items-center gap-2.5 border-b bg-muted/50 py-2.5 pr-4 pl-[18px] font-medium text-sm hover:bg-accent/50",
        className
      ),
      onClick: onToggle,
      type: "button"
    },
    isOpen ? /* @__PURE__ */ React.createElement(ChevronDownIcon, { className: "h-4 w-4 shrink-0 text-muted-foreground" }) : /* @__PURE__ */ React.createElement(ChevronRightIcon, { className: "h-4 w-4 shrink-0 text-muted-foreground" }),
    icon,
    /* @__PURE__ */ React.createElement("span", null, label),
    /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-xs" }, count)
  );
}
export {
  GroupSectionHeader
};
//# sourceMappingURL=group-section-header.mjs.map