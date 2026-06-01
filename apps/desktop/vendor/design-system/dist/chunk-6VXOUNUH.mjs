import React from "react";
// components/ui/primitives/match-list.tsx
import { Search } from "lucide-react";
function MatchList({ matches }) {
  if (matches.length === 0) {
    return /* @__PURE__ */ React.createElement("p", { className: "text-[11px] text-muted-foreground italic" }, "No matches");
  }
  return /* @__PURE__ */ React.createElement("div", { className: "overflow-hidden rounded-xl border border-border/70 bg-card/80 shadow-sm" }, /* @__PURE__ */ React.createElement("div", { className: "border-border/60 border-b bg-muted/35 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground" }, "Matches"), /* @__PURE__ */ React.createElement("div", { className: "max-h-80 overflow-auto p-2" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1.5" }, matches.map((match, index) => /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "rounded-lg border border-border/60 bg-background/60 px-3 py-2",
      key: `${match.file ?? "match"}-${match.line ?? index}-${index}`
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 text-[11px]" }, /* @__PURE__ */ React.createElement(Search, { className: "size-3.5 shrink-0 text-muted-foreground" }), match.file ? /* @__PURE__ */ React.createElement("span", { className: "break-all font-mono text-foreground" }, match.file) : null, typeof match.line === "number" ? /* @__PURE__ */ React.createElement("span", { className: "rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground" }, match.line) : null),
    match.text ? /* @__PURE__ */ React.createElement("pre", { className: "mt-2 whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground" }, match.text) : null
  )))));
}

export {
  MatchList
};
//# sourceMappingURL=chunk-6VXOUNUH.mjs.map