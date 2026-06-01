import React from "react";
"use client";
import {
  Progress
} from "../../chunk-OBV5RENT.mjs";
import {
  CollapsibleSection
} from "../../chunk-VMGHNFYV.mjs";
import "../../chunk-DPPRFUOX.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/evaluation-section.tsx
import { useState } from "react";
function EvaluationSection({
  title = "Evaluation",
  defaultOpen = false,
  state,
  awaitingMessage = "Awaiting LLM Judges feedback",
  emptyMessage = "No judges have been evaluated yet",
  acceptedCount = 0,
  totalCount = 0,
  children
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const acceptanceRate = totalCount > 0 ? Math.round(acceptedCount / totalCount * 100) : 0;
  return /* @__PURE__ */ React.createElement(
    CollapsibleSection,
    {
      onOpenChange: setIsOpen,
      open: isOpen,
      title
    },
    state === "awaiting" ? /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, awaitingMessage) : null,
    state === "empty" ? /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, emptyMessage) : null,
    state === "ready" ? /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1.5" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between text-xs" }, /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground" }, acceptedCount, "/", totalCount, " judges accepted"), /* @__PURE__ */ React.createElement("span", { className: "font-medium" }, acceptanceRate.toFixed(0), "%")), /* @__PURE__ */ React.createElement(Progress, { className: "h-2", value: acceptanceRate })), /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, children)) : null
  );
}
export {
  EvaluationSection
};
//# sourceMappingURL=evaluation-section.mjs.map