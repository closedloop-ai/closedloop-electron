import React from "react";
import {
  ToneBadge
} from "../../../chunk-FQSOQDF7.mjs";
import {
  Input
} from "../../../chunk-J7MGMQSF.mjs";
import "../../../chunk-3I7NW6GS.mjs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../../chunk-ZKMGHYX7.mjs";
import {
  Button
} from "../../../chunk-TT7DUYOP.mjs";
import "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/composites/cli-tools-panel.tsx
import { CheckCircle2, FileWarning, Search, Wrench } from "lucide-react";
var cliToolTone = {
  checking: { label: "Checking", tone: "info" },
  detected: { label: "Detected", tone: "success" },
  custom: { label: "Custom path", tone: "accent" },
  invalid: { label: "Invalid path", tone: "danger" },
  missing: { label: "Not found", tone: "warning" }
};
var cliToolIcon = {
  detected: CheckCircle2,
  custom: Wrench,
  invalid: FileWarning,
  missing: Search,
  checking: Search
};
function CliToolsPanel({
  tools,
  pathValues,
  onPathChange,
  onSavePath,
  onResetPath
}) {
  return /* @__PURE__ */ React.createElement("div", { className: "grid gap-4 lg:grid-cols-2" }, tools.map((tool) => {
    const status = cliToolTone[tool.state];
    const Icon = cliToolIcon[tool.state];
    const pathValue = pathValues?.[tool.id] ?? tool.path;
    return /* @__PURE__ */ React.createElement(Card, { className: "border-border/80", key: tool.id }, /* @__PURE__ */ React.createElement(CardHeader, { className: "flex flex-row items-start justify-between gap-3 space-y-0" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, /* @__PURE__ */ React.createElement(CardTitle, { className: "text-base" }, tool.name), /* @__PURE__ */ React.createElement(CardDescription, null, tool.description)), /* @__PURE__ */ React.createElement(ToneBadge, { label: status.label, tone: status.tone })), /* @__PURE__ */ React.createElement(CardContent, { className: "space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "grid gap-2 md:grid-cols-[1fr_auto]" }, /* @__PURE__ */ React.createElement(
      Input,
      {
        onChange: (event) => onPathChange?.(tool.id, event.target.value),
        placeholder: "Enter path to this tool",
        value: pathValue
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2" }, /* @__PURE__ */ React.createElement(
      Button,
      {
        disabled: !onSavePath,
        onClick: () => onSavePath?.(tool, pathValue),
        size: "sm"
      },
      "Save"
    ), /* @__PURE__ */ React.createElement(
      Button,
      {
        disabled: !onResetPath,
        onClick: () => onResetPath?.(tool),
        size: "sm",
        variant: "outline"
      },
      "Reset"
    ))), /* @__PURE__ */ React.createElement("div", { className: "flex items-start gap-2 rounded-lg border border-border bg-muted/35 px-3 py-2 text-sm" }, /* @__PURE__ */ React.createElement(Icon, { className: "mt-0.5 size-4 shrink-0 text-muted-foreground" }), /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground" }, tool.hint))));
  }));
}
export {
  CliToolsPanel
};
//# sourceMappingURL=cli-tools-panel.mjs.map