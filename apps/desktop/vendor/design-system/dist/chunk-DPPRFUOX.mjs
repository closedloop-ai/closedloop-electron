import React from "react";
// components/ui/section-header.tsx
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
function SectionHeader({
  title,
  children,
  isOpen,
  onToggle
}) {
  const showToggle = onToggle !== void 0 && isOpen !== void 0;
  return /* @__PURE__ */ React.createElement("div", { className: "flex h-12 items-center gap-2 border-b py-2" }, showToggle ? /* @__PURE__ */ React.createElement(
    "button",
    {
      "aria-expanded": isOpen,
      className: "flex shrink-0 items-center gap-2",
      onClick: onToggle,
      type: "button"
    },
    /* @__PURE__ */ React.createElement("span", { className: "font-semibold text-lg" }, title),
    isOpen ? /* @__PURE__ */ React.createElement(ChevronDownIcon, { className: "h-4 w-4" }) : /* @__PURE__ */ React.createElement(ChevronRightIcon, { className: "h-4 w-4" })
  ) : /* @__PURE__ */ React.createElement("span", { className: "shrink-0 font-semibold text-lg" }, title), /* @__PURE__ */ React.createElement("div", { className: "min-w-0 flex-1" }), children ? /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 items-center gap-2" }, children) : null);
}

export {
  SectionHeader
};
//# sourceMappingURL=chunk-DPPRFUOX.mjs.map