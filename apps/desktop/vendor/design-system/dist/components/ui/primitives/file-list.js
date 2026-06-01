var React = require("react");
"use strict";
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

// components/ui/primitives/file-list.tsx
var file_list_exports = {};
__export(file_list_exports, {
  FileList: () => FileList
});
module.exports = __toCommonJS(file_list_exports);
var import_lucide_react = require("lucide-react");
function FileList({ paths }) {
  if (paths.length === 0) {
    return /* @__PURE__ */ React.createElement("p", { className: "text-[11px] text-muted-foreground italic" }, "No files");
  }
  return /* @__PURE__ */ React.createElement("div", { className: "overflow-hidden rounded-xl border border-border/70 bg-card/80 shadow-sm" }, /* @__PURE__ */ React.createElement("div", { className: "border-border/60 border-b bg-muted/35 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground" }, "Files"), /* @__PURE__ */ React.createElement("div", { className: "max-h-80 overflow-auto p-2" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1.5" }, paths.map((path) => /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "flex items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2",
      key: path
    },
    /* @__PURE__ */ React.createElement(import_lucide_react.FolderOpen, { className: "size-3.5 shrink-0 text-muted-foreground" }),
    /* @__PURE__ */ React.createElement("span", { className: "break-all font-mono text-[11px] text-foreground" }, path)
  )))));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FileList
});
//# sourceMappingURL=file-list.js.map