import React from "react";
"use client";
import {
  MarkdownContent
} from "../../../chunk-TDRHJLNM.mjs";
import "../../../chunk-BPFSJREZ.mjs";
import "../../../chunk-L5AZJM2L.mjs";
import "../../../chunk-TT7DUYOP.mjs";
import "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-JHIJKM5E.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/primitives/thinking-block.tsx
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
function ThinkingBlock({
  text,
  defaultExpanded = false
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (!text) {
    return null;
  }
  return /* @__PURE__ */ React.createElement("div", { className: "overflow-hidden rounded-lg border border-amber-500/20 bg-amber-500/5" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-amber-500/10",
      onClick: () => setExpanded((value) => !value),
      type: "button"
    },
    expanded ? /* @__PURE__ */ React.createElement(ChevronDown, { className: "size-3.5 text-amber-500/60" }) : /* @__PURE__ */ React.createElement(ChevronRight, { className: "size-3.5 text-amber-500/60" }),
    /* @__PURE__ */ React.createElement(Brain, { className: "size-3.5 text-amber-400/80" }),
    /* @__PURE__ */ React.createElement("span", { className: "font-medium text-amber-200/90 text-xs" }, "Thinking"),
    !expanded ? /* @__PURE__ */ React.createElement("span", { className: "ml-auto font-mono text-[10px] text-amber-300/40" }, text.length.toLocaleString(), " chars") : null
  ), expanded ? /* @__PURE__ */ React.createElement("div", { className: "border-amber-500/10 border-t px-3 py-2 text-amber-100/80" }, /* @__PURE__ */ React.createElement(MarkdownContent, { dense: true, text })) : null);
}
export {
  ThinkingBlock
};
//# sourceMappingURL=thinking-block.mjs.map