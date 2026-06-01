import React from "react";
"use client";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/group-header-row.tsx
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
function GroupHeaderRow({
  title,
  count,
  isOpen,
  onToggle,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      className: cn(
        "flex h-12 w-full cursor-pointer items-center gap-1 border-b bg-background px-1 text-left hover:bg-muted/50",
        className
      ),
      onClick: onToggle,
      type: "button"
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 items-center justify-center p-1.5" }, isOpen ? /* @__PURE__ */ React.createElement(ChevronDownIcon, { className: "h-5 w-5 text-muted-foreground" }) : /* @__PURE__ */ React.createElement(ChevronRightIcon, { className: "h-5 w-5 text-muted-foreground" })),
    /* @__PURE__ */ React.createElement("span", { className: "font-medium text-foreground text-sm" }, title),
    /* @__PURE__ */ React.createElement("span", { className: "ml-1 text-muted-foreground text-xs" }, "(", count, ")")
  );
}
export {
  GroupHeaderRow
};
//# sourceMappingURL=group-header-row.mjs.map