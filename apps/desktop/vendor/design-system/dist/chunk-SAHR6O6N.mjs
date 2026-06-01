import React from "react";
// components/ui/primitives/file-list.tsx
import { FolderOpen } from "lucide-react";
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
    /* @__PURE__ */ React.createElement(FolderOpen, { className: "size-3.5 shrink-0 text-muted-foreground" }),
    /* @__PURE__ */ React.createElement("span", { className: "break-all font-mono text-[11px] text-foreground" }, path)
  )))));
}

export {
  FileList
};
//# sourceMappingURL=chunk-SAHR6O6N.mjs.map