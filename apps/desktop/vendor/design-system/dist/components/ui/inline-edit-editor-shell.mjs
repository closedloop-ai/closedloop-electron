import React from "react";
"use client";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/inline-edit-editor-shell.tsx
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
export {
  InlineEditEditorShell
};
//# sourceMappingURL=inline-edit-editor-shell.mjs.map