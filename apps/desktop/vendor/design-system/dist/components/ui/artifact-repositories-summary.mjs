import React from "react";
import {
  MetadataSection
} from "../../chunk-ZOB3YFAZ.mjs";
import "../../chunk-76IVWEZL.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/artifact-repositories-summary.tsx
import { GitBranch } from "lucide-react";
function ArtifactRepositoriesSummary({
  snapshot,
  layout = "horizontal",
  title,
  separator = false
}) {
  const entries = orderedEntries(snapshot);
  if (layout === "horizontal") {
    if (entries.length === 0) {
      return /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-sm" }, "No repositories");
    }
    return /* @__PURE__ */ React.createElement(React.Fragment, null, entries.map((entry) => /* @__PURE__ */ React.createElement(RepoPill, { entry, key: `${entry.position}-${entry.fullName}` })));
  }
  return /* @__PURE__ */ React.createElement(MetadataSection, { separator }, title ? /* @__PURE__ */ React.createElement("h4", { className: "font-medium text-sm" }, title) : null, entries.length === 0 ? /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, "No repositories") : /* @__PURE__ */ React.createElement("ul", { className: "space-y-1.5" }, entries.map((entry) => /* @__PURE__ */ React.createElement(
    "li",
    {
      className: "flex items-center gap-2 text-sm",
      key: `${entry.position}-${entry.fullName}`
    },
    /* @__PURE__ */ React.createElement(
      GitBranch,
      {
        "aria-hidden": "true",
        className: "h-3.5 w-3.5 text-muted-foreground"
      }
    ),
    /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cn(
          entry.role === "primary" ? "font-medium" : void 0
        )
      },
      entry.fullName
    ),
    entry.role === "primary" ? /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-xs uppercase tracking-wide" }, "Primary") : null,
    entry.branch || entry.ref ? /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-xs" }, entry.branch ?? entry.ref) : null
  ))));
}
function RepoPill({
  entry
}) {
  return /* @__PURE__ */ React.createElement(
    "span",
    {
      className: cn(
        "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm",
        entry.role === "primary" ? "bg-muted/50 font-medium" : "text-muted-foreground"
      ),
      title: entry.role === "primary" ? `${entry.fullName} (primary)` : entry.fullName
    },
    /* @__PURE__ */ React.createElement(GitBranch, { "aria-hidden": "true", className: "h-3.5 w-3.5 shrink-0" }),
    /* @__PURE__ */ React.createElement("span", { className: "truncate" }, entry.fullName),
    entry.branch || entry.ref ? /* @__PURE__ */ React.createElement("span", { className: "shrink-0 text-muted-foreground text-xs" }, "@", entry.branch ?? entry.ref) : null
  );
}
function orderedEntries(snapshot) {
  return [...snapshot.repositories].sort((a, b) => {
    if (a.role === "primary" && b.role !== "primary") {
      return -1;
    }
    if (b.role === "primary" && a.role !== "primary") {
      return 1;
    }
    return a.position - b.position;
  });
}
export {
  ArtifactRepositoriesSummary
};
//# sourceMappingURL=artifact-repositories-summary.mjs.map