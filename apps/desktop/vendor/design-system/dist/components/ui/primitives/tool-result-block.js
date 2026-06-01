var React = require("react");
"use strict";
"use client";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// components/ui/primitives/tool-result-block.tsx
var tool_result_block_exports = {};
__export(tool_result_block_exports, {
  ToolResultBlock: () => ToolResultBlock
});
module.exports = __toCommonJS(tool_result_block_exports);
var import_lucide_react = require("lucide-react");
var import_react = require("react");

// components/ui/utils.ts
var SIMPLE_TUI_TAGS = {
  "local-command-caveat": "caveat",
  "local-command-stdout": "stdout",
  "local-command-stderr": "stderr",
  "system-reminder": "system-reminder",
  "persisted-output": "persisted-output"
};
var COMMAND_TUI_TAGS = [
  "command-name",
  "command-message",
  "command-args"
];
var KNOWN_TUI_TAG_RE = new RegExp(
  `<(?:${[...Object.keys(SIMPLE_TUI_TAGS), ...COMMAND_TUI_TAGS].join("|")})\\b`
);
function stringifyJsonValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

// components/ui/primitives/tool-result-block.tsx
function ToolResultBlock({
  result,
  defaultExpanded = false
}) {
  const [expanded, setExpanded] = (0, import_react.useState)(defaultExpanded);
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
    expanded ? /* @__PURE__ */ React.createElement(import_lucide_react.ChevronDown, { className: "size-3 shrink-0" }) : /* @__PURE__ */ React.createElement(import_lucide_react.ChevronRight, { className: "size-3 shrink-0" }),
    result.isError ? /* @__PURE__ */ React.createElement(import_lucide_react.XCircle, { className: "size-3 shrink-0" }) : /* @__PURE__ */ React.createElement(import_lucide_react.CheckCircle2, { className: "size-3 shrink-0" }),
    /* @__PURE__ */ React.createElement("span", null, "Tool result"),
    /* @__PURE__ */ React.createElement("span", { className: "text-[10px] opacity-70" }, "(", lines, " ", lines === 1 ? "line" : "lines", ")")
  ), expanded ? /* @__PURE__ */ React.createElement("pre", { className: "max-h-72 overflow-auto whitespace-pre-wrap break-words border-current/20 border-t px-3 py-2 font-mono text-[11px] opacity-90" }, text) : null);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ToolResultBlock
});
//# sourceMappingURL=tool-result-block.js.map