import React from "react";
"use client";
import {
  UnifiedDiff
} from "../../../chunk-WCPI6B5C.mjs";
import {
  TerminalBlock
} from "../../../chunk-OXJN6TZY.mjs";
import {
  KeyValueGrid
} from "../../../chunk-5U35WVIE.mjs";
import {
  CodeBlock
} from "../../../chunk-BPFSJREZ.mjs";
import "../../../chunk-L5AZJM2L.mjs";
import {
  stringifyJsonValue
} from "../../../chunk-UGNO5UUO.mjs";
import "../../../chunk-TT7DUYOP.mjs";
import "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-JHIJKM5E.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/primitives/tool-call-block.tsx
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronRight,
  FilePen,
  FilePlus2,
  FileText,
  FolderTree,
  Globe,
  ListTodo,
  Search,
  Sparkles,
  Terminal,
  Wrench
} from "lucide-react";
import { useState } from "react";
var DEFAULT_STYLE = {
  Icon: Wrench,
  text: "text-violet-300",
  chip: "bg-violet-500/15 text-violet-300",
  border: "border-violet-500/20"
};
var TOOL_STYLES = {
  bash: {
    Icon: Terminal,
    text: "text-emerald-300",
    chip: "bg-emerald-500/15 text-emerald-300",
    border: "border-emerald-500/20"
  },
  read: {
    Icon: FileText,
    text: "text-sky-300",
    chip: "bg-sky-500/15 text-sky-300",
    border: "border-sky-500/20"
  },
  write: {
    Icon: FilePlus2,
    text: "text-violet-300",
    chip: "bg-violet-500/15 text-violet-300",
    border: "border-violet-500/20"
  },
  edit: {
    Icon: FilePen,
    text: "text-amber-300",
    chip: "bg-amber-500/15 text-amber-300",
    border: "border-amber-500/20"
  },
  multiedit: {
    Icon: FilePen,
    text: "text-amber-300",
    chip: "bg-amber-500/15 text-amber-300",
    border: "border-amber-500/20"
  },
  grep: {
    Icon: Search,
    text: "text-cyan-300",
    chip: "bg-cyan-500/15 text-cyan-300",
    border: "border-cyan-500/20"
  },
  glob: {
    Icon: FolderTree,
    text: "text-cyan-300",
    chip: "bg-cyan-500/15 text-cyan-300",
    border: "border-cyan-500/20"
  },
  webfetch: {
    Icon: Globe,
    text: "text-blue-300",
    chip: "bg-blue-500/15 text-blue-300",
    border: "border-blue-500/20"
  },
  task: {
    Icon: Bot,
    text: "text-pink-300",
    chip: "bg-pink-500/15 text-pink-300",
    border: "border-pink-500/20"
  },
  agent: {
    Icon: Bot,
    text: "text-pink-300",
    chip: "bg-pink-500/15 text-pink-300",
    border: "border-pink-500/20"
  },
  todowrite: {
    Icon: ListTodo,
    text: "text-rose-300",
    chip: "bg-rose-500/15 text-rose-300",
    border: "border-rose-500/20"
  },
  skill: {
    Icon: Sparkles,
    text: "text-fuchsia-300",
    chip: "bg-fuchsia-500/15 text-fuchsia-300",
    border: "border-fuchsia-500/20"
  }
};
var LINE_SPLIT_RE = /\r?\n/;
function styleForTool(name) {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return TOOL_STYLES[key] ?? DEFAULT_STYLE;
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function diffFromStrings(oldString, newString) {
  if (!(oldString || newString)) {
    return [];
  }
  const oldLines = oldString ? oldString.split(LINE_SPLIT_RE) : [];
  const newLines = newString ? newString.split(LINE_SPLIT_RE) : [];
  return [
    {
      oldStart: 1,
      newStart: 1,
      oldLines: oldLines.length,
      newLines: newLines.length,
      lines: [
        ...oldLines.map((line) => `-${line}`),
        ...newLines.map((line) => `+${line}`)
      ]
    }
  ];
}
function buildSummary(toolUse) {
  const input = asRecord(toolUse.input);
  if (!input) {
    return null;
  }
  if (typeof input.file_path === "string") {
    return input.file_path;
  }
  if (typeof input.path === "string") {
    return input.path;
  }
  if (typeof input.command === "string") {
    return input.command.slice(0, 200);
  }
  if (typeof input.pattern === "string") {
    return input.pattern;
  }
  if (typeof input.query === "string") {
    return input.query;
  }
  if (typeof input.url === "string") {
    return input.url;
  }
  return null;
}
function renderBashInput(input) {
  if (typeof input.command !== "string") {
    return null;
  }
  return /* @__PURE__ */ React.createElement(
    TerminalBlock,
    {
      command: input.command,
      description: typeof input.description === "string" ? input.description : void 0
    }
  );
}
function renderWriteInput(input) {
  if (typeof input.file_path !== "string" || typeof input.content !== "string") {
    return null;
  }
  return /* @__PURE__ */ React.createElement(
    CodeBlock,
    {
      code: input.content,
      filename: input.file_path,
      label: "new file"
    }
  );
}
function renderEditInput(input) {
  if (typeof input.file_path !== "string") {
    return null;
  }
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 text-[11px] text-muted-foreground" }, /* @__PURE__ */ React.createElement(FileText, { className: "size-3.5" }), /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, input.file_path)), typeof input.old_string === "string" ? /* @__PURE__ */ React.createElement(
    CodeBlock,
    {
      code: input.old_string,
      label: "removed",
      tone: "danger"
    }
  ) : null, typeof input.new_string === "string" ? /* @__PURE__ */ React.createElement(
    CodeBlock,
    {
      code: input.new_string,
      label: "added",
      tone: "success"
    }
  ) : null);
}
function renderReadInput(input) {
  if (typeof input.file_path !== "string") {
    return null;
  }
  return /* @__PURE__ */ React.createElement(
    TerminalBlock,
    {
      command: `read ${input.file_path}`,
      description: [
        typeof input.offset === "number" ? `offset=${input.offset}` : null,
        typeof input.limit === "number" ? `limit=${input.limit}` : null
      ].filter(Boolean).join(" \xB7 ")
    }
  );
}
function renderGrepInput(input) {
  if (typeof input.pattern !== "string") {
    return null;
  }
  return /* @__PURE__ */ React.createElement(
    KeyValueGrid,
    {
      data: {
        pattern: input.pattern,
        ...typeof input.path === "string" ? { path: input.path } : {},
        ...typeof input.glob === "string" ? { glob: input.glob } : {}
      },
      priority: ["pattern", "path", "glob"]
    }
  );
}
function renderInput(toolUse) {
  const input = asRecord(toolUse.input);
  if (!input) {
    return /* @__PURE__ */ React.createElement(KeyValueGrid, { data: { input: toolUse.input } });
  }
  const tool = toolUse.name.toLowerCase();
  if (tool === "bash") {
    return renderBashInput(input) ?? /* @__PURE__ */ React.createElement(KeyValueGrid, { data: input });
  }
  if (tool === "write") {
    return renderWriteInput(input) ?? /* @__PURE__ */ React.createElement(KeyValueGrid, { data: input });
  }
  if (tool === "edit") {
    return renderEditInput(input) ?? /* @__PURE__ */ React.createElement(KeyValueGrid, { data: input });
  }
  if (tool === "read") {
    return renderReadInput(input) ?? /* @__PURE__ */ React.createElement(KeyValueGrid, { data: input });
  }
  if (tool === "grep") {
    return renderGrepInput(input) ?? /* @__PURE__ */ React.createElement(KeyValueGrid, { data: input });
  }
  return /* @__PURE__ */ React.createElement(KeyValueGrid, { data: input });
}
function renderResult(toolResult, toolName) {
  const text = stringifyJsonValue(toolResult.output);
  if (!text) {
    return /* @__PURE__ */ React.createElement("div", { className: "text-[11px] text-muted-foreground italic" }, "(empty)");
  }
  const tool = toolName.toLowerCase();
  const trimmed = text.trim();
  if (tool === "edit" && trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.old_string === "string" && typeof parsed.new_string === "string") {
        return /* @__PURE__ */ React.createElement(
          UnifiedDiff,
          {
            hunks: diffFromStrings(parsed.old_string, parsed.new_string)
          }
        );
      }
    } catch {
    }
  }
  let label = "output";
  let tone = "default";
  if (toolResult.isError) {
    label = "error";
    tone = "danger";
  }
  const record = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (record) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return /* @__PURE__ */ React.createElement(KeyValueGrid, { data: parsed });
      }
    } catch {
    }
  }
  return /* @__PURE__ */ React.createElement(
    CodeBlock,
    {
      code: text,
      label,
      showLineNumbers: text.includes("\n"),
      tone
    }
  );
}
function ToolCallBlock({
  toolUse,
  toolResult
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = buildSummary(toolUse);
  const style = styleForTool(toolUse.name);
  const Icon = style.Icon;
  let statusBadge = null;
  if (toolResult?.isError) {
    statusBadge = /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1 rounded border border-red-500/25 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-200 uppercase tracking-[0.12em]" }, /* @__PURE__ */ React.createElement(AlertCircle, { className: "size-3" }), "error");
  } else if (toolResult) {
    statusBadge = /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1 rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-200 uppercase tracking-[0.12em]" }, /* @__PURE__ */ React.createElement(CheckCircle2, { className: "size-3" }), "complete");
  }
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `overflow-hidden rounded-xl border bg-card/70 ${toolResult?.isError ? "border-red-500/25 bg-red-950/10" : style.border}`
    },
    /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/35",
        onClick: () => setExpanded((value) => !value),
        type: "button"
      },
      /* @__PURE__ */ React.createElement(
        ChevronRight,
        {
          className: `size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`
        }
      ),
      /* @__PURE__ */ React.createElement(
        "span",
        {
          className: `inline-flex size-5 shrink-0 items-center justify-center rounded ${style.chip}`
        },
        /* @__PURE__ */ React.createElement(Icon, { className: "size-3" })
      ),
      /* @__PURE__ */ React.createElement("span", { className: `font-medium font-mono text-[13px] ${style.text}` }, toolUse.name),
      summary ? /* @__PURE__ */ React.createElement("span", { className: "min-w-0 truncate font-mono text-[11px] text-muted-foreground" }, summary) : null,
      /* @__PURE__ */ React.createElement("span", { className: "ml-auto shrink-0" }, statusBadge)
    ),
    expanded ? /* @__PURE__ */ React.createElement("div", { className: "space-y-3 border-border/60 border-t px-3 py-3" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1.5" }, /* @__PURE__ */ React.createElement("p", { className: "font-medium text-[11px] text-muted-foreground uppercase tracking-[0.12em]" }, "Input"), renderInput(toolUse)), toolResult ? /* @__PURE__ */ React.createElement("div", { className: "space-y-1.5" }, /* @__PURE__ */ React.createElement("p", { className: "font-medium text-[11px] text-muted-foreground uppercase tracking-[0.12em]" }, "Result"), renderResult(toolResult, toolUse.name)) : null) : null
  );
}
export {
  ToolCallBlock
};
//# sourceMappingURL=tool-call-block.mjs.map