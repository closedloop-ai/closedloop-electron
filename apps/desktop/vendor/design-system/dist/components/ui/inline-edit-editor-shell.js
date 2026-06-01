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

// components/ui/inline-edit-editor-shell.tsx
var inline_edit_editor_shell_exports = {};
__export(inline_edit_editor_shell_exports, {
  InlineEditEditorShell: () => InlineEditEditorShell
});
module.exports = __toCommonJS(inline_edit_editor_shell_exports);
function InlineEditEditorShell({
  expanded,
  toolbar,
  children
}) {
  return /* @__PURE__ */ React.createElement(React.Fragment, null, expanded ? toolbar : null, /* @__PURE__ */ React.createElement(
    "div",
    {
      className: expanded ? "flex min-h-[200px] flex-col border-b" : "flex max-h-[72vh] flex-col overflow-hidden border-b"
    },
    children
  ));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  InlineEditEditorShell
});
//# sourceMappingURL=inline-edit-editor-shell.js.map