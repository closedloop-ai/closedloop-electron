var React = require("react");
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// components/ui/artifact-repositories-summary.tsx
var artifact_repositories_summary_exports = {};
__export(artifact_repositories_summary_exports, {
  ArtifactRepositoriesSummary: () => ArtifactRepositoriesSummary
});
module.exports = __toCommonJS(artifact_repositories_summary_exports);

// components/ui/tabs.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/metadata-panel.tsx
function MetadataSection({
  children,
  separator,
  className,
  layout = "vertical"
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        layout === "horizontal" ? "flex flex-wrap items-center gap-2" : "space-y-2",
        layout === "vertical" && separator ? "border-t pt-4" : null,
        className
      )
    },
    children
  );
}

// components/ui/artifact-repositories-summary.tsx
var import_lucide_react = require("lucide-react");
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
      import_lucide_react.GitBranch,
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
    /* @__PURE__ */ React.createElement(import_lucide_react.GitBranch, { "aria-hidden": "true", className: "h-3.5 w-3.5 shrink-0" }),
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ArtifactRepositoriesSummary
});
//# sourceMappingURL=artifact-repositories-summary.js.map