import React from "react";
import {
  SectionHeader
} from "./chunk-DPPRFUOX.mjs";

// components/ui/collapsible-section.tsx
function CollapsibleSection({
  title,
  open,
  onOpenChange,
  children,
  contentClassName = "space-y-4 pt-3 pb-3"
}) {
  return /* @__PURE__ */ React.createElement("div", { className: "bg-background" }, /* @__PURE__ */ React.createElement(
    SectionHeader,
    {
      isOpen: open,
      onToggle: () => onOpenChange(!open),
      title
    }
  ), open ? /* @__PURE__ */ React.createElement("div", { className: contentClassName }, children) : null);
}

export {
  CollapsibleSection
};
//# sourceMappingURL=chunk-VMGHNFYV.mjs.map