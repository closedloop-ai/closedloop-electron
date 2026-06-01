import React from "react";
"use client";
import {
  stringifyJsonValue
} from "../../../chunk-UGNO5UUO.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/primitives/tool-result-block.tsx
import { CheckCircle2, ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { useState } from "react";
function ToolResultBlock({
  result,
  defaultExpanded = false
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const text = stringifyJsonValue(result.output);
  const lines = text.split("\n").length;
  const tone = result.isError ? "border-red-500/30 bg-red-500/5 text-red-200" : "border-emerald-500/20 bg-emerald-500/5 text-emerald-200";
  return /* @__PURE__ */ React.createElement("div", { className: `rounded-md border ${tone}` }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors hover:bg-white/5",
      onClick: () => setExpanded((value) => !value),
      type: "button"
    },
    expanded ? /* @__PURE__ */ React.createElement(ChevronDown, { className: "size-3 shrink-0" }) : /* @__PURE__ */ React.createElement(ChevronRight, { className: "size-3 shrink-0" }),
    result.isError ? /* @__PURE__ */ React.createElement(XCircle, { className: "size-3 shrink-0" }) : /* @__PURE__ */ React.createElement(CheckCircle2, { className: "size-3 shrink-0" }),
    /* @__PURE__ */ React.createElement("span", null, "Tool result"),
    /* @__PURE__ */ React.createElement("span", { className: "text-[10px] opacity-70" }, "(", lines, " ", lines === 1 ? "line" : "lines", ")")
  ), expanded ? /* @__PURE__ */ React.createElement("pre", { className: "max-h-72 overflow-auto whitespace-pre-wrap break-words border-current/20 border-t px-3 py-2 font-mono text-[11px] opacity-90" }, text) : null);
}
export {
  ToolResultBlock
};
//# sourceMappingURL=tool-result-block.mjs.map