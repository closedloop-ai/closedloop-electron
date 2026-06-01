import React from "react";
// components/ui/primitives/unified-diff.tsx
function UnifiedDiff({ hunks }) {
  if (hunks.length === 0) {
    return /* @__PURE__ */ React.createElement("p", { className: "text-[11px] text-muted-foreground italic" }, "No diff");
  }
  return /* @__PURE__ */ React.createElement("div", { className: "overflow-hidden rounded-xl border border-border/70 bg-zinc-950/95 shadow-sm" }, /* @__PURE__ */ React.createElement("div", { className: "max-h-96 overflow-auto" }, hunks.map((hunk) => /* @__PURE__ */ React.createElement(
    UnifiedDiffHunk,
    {
      hunk,
      key: `${hunk.oldStart}-${hunk.newStart}`
    }
  ))));
}
function UnifiedDiffHunk({ hunk }) {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "border-cyan-500/20 border-y bg-cyan-500/10 px-3 py-1 font-mono text-[10px] text-cyan-200" }, "@@ -", hunk.oldStart, ",", hunk.oldLines, " +", hunk.newStart, ",", hunk.newLines, " @@"), /* @__PURE__ */ React.createElement("table", { className: "w-full border-collapse font-mono text-[11px]" }, /* @__PURE__ */ React.createElement("tbody", null, hunk.lines.map((line) => {
    let kind = "context";
    if (line.startsWith("+")) {
      kind = "add";
    } else if (line.startsWith("-")) {
      kind = "remove";
    }
    const content = line.slice(kind === "context" ? 0 : 1);
    const oldCell = kind === "add" ? "" : oldLine++;
    const newCell = kind === "remove" ? "" : newLine++;
    let rowClassName = "text-zinc-200";
    if (kind === "add") {
      rowClassName = "bg-emerald-500/10 text-emerald-100";
    } else if (kind === "remove") {
      rowClassName = "bg-red-500/10 text-red-100";
    }
    let sign = " ";
    if (kind === "add") {
      sign = "+";
    } else if (kind === "remove") {
      sign = "-";
    }
    return /* @__PURE__ */ React.createElement(
      "tr",
      {
        className: rowClassName,
        key: `diff-${oldCell}-${newCell}-${content.slice(0, 24)}`
      },
      /* @__PURE__ */ React.createElement("td", { className: "w-10 border-border/40 border-r px-2 text-right text-zinc-500" }, oldCell),
      /* @__PURE__ */ React.createElement("td", { className: "w-10 border-border/40 border-r px-2 text-right text-zinc-500" }, newCell),
      /* @__PURE__ */ React.createElement("td", { className: "w-4 px-1 text-center" }, sign),
      /* @__PURE__ */ React.createElement("td", { className: "whitespace-pre-wrap break-words px-2 py-0.5" }, content)
    );
  }))));
}

export {
  UnifiedDiff
};
//# sourceMappingURL=chunk-WCPI6B5C.mjs.map