var React = require("react");
"use strict";
"use client";
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

// components/ui/primitives/tool-call-block.tsx
var tool_call_block_exports = {};
__export(tool_call_block_exports, {
  ToolCallBlock: () => ToolCallBlock
});
module.exports = __toCommonJS(tool_call_block_exports);
var import_lucide_react4 = require("lucide-react");
var import_react2 = require("react");

// components/ui/primitives/code-block.tsx
var import_lucide_react2 = require("lucide-react");

// components/ui/button.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/button.tsx
var buttonVariants = (0, import_class_variance_authority.cva)(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline: "border border-input-border bg-input hover:bg-muted hover:text-foreground dark:bg-input dark:hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4 gap-2 py-2 has-[>svg]:px-3 [&_svg:not([class*='size-'])]:size-4",
        sm: "h-8 rounded-md gap-2 px-3 has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 rounded-md gap-2 px-6 has-[>svg]:px-4 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-9 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-4"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);
function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? import_radix_ui.Slot.Slot : "button";
  return /* @__PURE__ */ React2.createElement(
    Comp,
    {
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size, className })),
      ...props
    }
  );
}

// hooks/use-copy-to-clipboard.ts
var import_react = require("react");
function useCopyToClipboard(resetDelayMs = 2e3) {
  const [copied, setCopied] = (0, import_react.useState)(false);
  const resetTimerRef = (0, import_react.useRef)(null);
  const clearResetTimer = (0, import_react.useCallback)(() => {
    if (resetTimerRef.current === null) {
      return;
    }
    clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }, []);
  (0, import_react.useEffect)(() => clearResetTimer, [clearResetTimer]);
  const copy = (0, import_react.useCallback)(
    async (value) => {
      if (!value) {
        return false;
      }
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        return false;
      }
      setCopied(true);
      clearResetTimer();
      resetTimerRef.current = setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, resetDelayMs);
      return true;
    },
    [clearResetTimer, resetDelayMs]
  );
  return [copied, copy];
}

// components/ui/primitives/copy-button.tsx
var import_lucide_react = require("lucide-react");
function CopyButton({
  text,
  label = "Copy"
}) {
  const [copied, copy] = useCopyToClipboard(1500);
  return /* @__PURE__ */ React.createElement(
    Button,
    {
      className: "h-6 gap-1 px-2 text-[10px] text-muted-foreground",
      onClick: async () => {
        await copy(text);
      },
      size: "sm",
      type: "button",
      variant: "ghost"
    },
    copied ? /* @__PURE__ */ React.createElement(import_lucide_react.Check, { className: "size-3" }) : /* @__PURE__ */ React.createElement(import_lucide_react.Copy, { className: "size-3" }),
    copied ? "Copied" : label
  );
}

// components/ui/primitives/code-block.tsx
var toneClasses = {
  default: {
    wrapper: "border-border/70 bg-zinc-950/95",
    chrome: "border-border/60 bg-black/30",
    label: "text-zinc-400"
  },
  danger: {
    wrapper: "border-red-500/25 bg-red-950/20",
    chrome: "border-red-500/20 bg-red-950/25",
    label: "text-red-200"
  },
  success: {
    wrapper: "border-emerald-500/25 bg-emerald-950/20",
    chrome: "border-emerald-500/20 bg-emerald-950/25",
    label: "text-emerald-200"
  }
};
function CodeBlock({
  code,
  children,
  className,
  filename,
  compact = false,
  label,
  tone = "default",
  maxHeight = "24rem",
  showLineNumbers
}) {
  const content = code ?? children ?? "";
  const lines = content.split("\n");
  const gutter = showLineNumbers ?? lines.length >= 4;
  const palette = toneClasses[tone];
  let lineNumber = 1;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `overflow-hidden rounded-xl border shadow-sm ${palette.wrapper} ${className ?? ""}`
    },
    compact ? null : /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `flex items-center justify-between border-b px-3 py-1.5 ${palette.chrome}`
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          className: `flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] ${palette.label}`
        },
        filename ? /* @__PURE__ */ React.createElement(import_lucide_react2.FileCode, { className: "size-3" }) : null,
        /* @__PURE__ */ React.createElement("span", null, filename ?? label ?? "code")
      ),
      /* @__PURE__ */ React.createElement(CopyButton, { text: content })
    ),
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "overflow-auto",
        style: maxHeight ? { maxHeight } : void 0
      },
      gutter ? /* @__PURE__ */ React.createElement("table", { className: "w-full border-collapse font-mono text-[11px] leading-relaxed" }, /* @__PURE__ */ React.createElement("tbody", null, lines.map((line) => {
        const currentLine = lineNumber++;
        return /* @__PURE__ */ React.createElement("tr", { key: `line-${currentLine}-${line.slice(0, 24)}` }, /* @__PURE__ */ React.createElement("td", { className: "w-10 select-none border-border/40 border-r bg-black/15 px-2 text-right text-zinc-500" }, currentLine), /* @__PURE__ */ React.createElement("td", { className: "whitespace-pre-wrap break-words px-3 py-0.5 text-zinc-100" }, line || " "));
      }))) : /* @__PURE__ */ React.createElement("pre", { className: "whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] text-zinc-100 leading-relaxed" }, content)
    )
  );
}

// components/ui/primitives/key-value-grid.tsx
function renderValue(value) {
  if (value === null) {
    return /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground italic" }, "null");
  }
  if (typeof value === "boolean") {
    return /* @__PURE__ */ React.createElement("span", { className: "rounded border border-border bg-muted px-2 py-0.5 font-mono text-[11px]" }, value ? "true" : "false");
  }
  if (typeof value === "number") {
    return /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, value.toLocaleString());
  }
  if (typeof value === "string") {
    return /* @__PURE__ */ React.createElement("span", { className: "break-all font-mono text-foreground" }, value);
  }
  return /* @__PURE__ */ React.createElement("pre", { className: "overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground" }, JSON.stringify(value, null, 2));
}
function KeyValueGrid({
  data,
  priority = []
}) {
  const priorityEntries = priority.map((key) => [key, data[key]]).filter((entry) => entry[1] !== void 0);
  const restEntries = Object.entries(data).filter(
    ([key]) => !priority.includes(key)
  );
  const rows = [...priorityEntries, ...restEntries];
  if (rows.length === 0) {
    return /* @__PURE__ */ React.createElement("p", { className: "text-[11px] text-muted-foreground italic" }, "Empty");
  }
  return /* @__PURE__ */ React.createElement("div", { className: "overflow-hidden rounded-xl border border-border/70 bg-card/70" }, /* @__PURE__ */ React.createElement("table", { className: "w-full border-collapse text-[11px]" }, /* @__PURE__ */ React.createElement("tbody", null, rows.map(([key, value], index) => /* @__PURE__ */ React.createElement(
    "tr",
    {
      className: index > 0 ? "border-border/70 border-t" : void 0,
      key
    },
    /* @__PURE__ */ React.createElement("td", { className: "w-[28%] bg-muted/45 px-3 py-2 align-top font-mono text-muted-foreground" }, key),
    /* @__PURE__ */ React.createElement("td", { className: "px-3 py-2 align-top" }, renderValue(value))
  )))));
}

// components/ui/primitives/terminal-block.tsx
var import_lucide_react3 = require("lucide-react");
function TerminalBlock({
  command,
  description,
  label = "terminal",
  text,
  stream
}) {
  const body = text ?? [description ? `# ${description}` : null, command ? `$ ${command}` : null].filter(Boolean).join("\n");
  const isErrorStream = stream === "stderr";
  return /* @__PURE__ */ React.createElement("div", { className: "overflow-hidden rounded-xl border border-border/70 bg-zinc-950/95 shadow-sm" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between border-border/60 border-b bg-black/30 px-3 py-1.5" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1.5 text-[10px] text-zinc-400 uppercase tracking-[0.12em]" }, /* @__PURE__ */ React.createElement(import_lucide_react3.Terminal, { className: "size-3" }), /* @__PURE__ */ React.createElement("span", null, stream ?? label)), /* @__PURE__ */ React.createElement(CopyButton, { label: "Copy", text: body })), /* @__PURE__ */ React.createElement(
    "pre",
    {
      className: `max-h-96 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed ${isErrorStream ? "text-red-200" : "text-zinc-100"}`
    },
    body
  ));
}

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

// components/ui/utils.ts
var SIMPLE_TUI_TAGS = {
  "local-command-caveat": "caveat",
  "local-command-stdout": "stdout",
  "local-command-stderr": "stderr",
  "system-reminder": "system-reminder",
  "persisted-output": "persisted-output"
};
var COMMAND_TUI_TAGS = [
  "command-name",
  "command-message",
  "command-args"
];
var KNOWN_TUI_TAG_RE = new RegExp(
  `<(?:${[...Object.keys(SIMPLE_TUI_TAGS), ...COMMAND_TUI_TAGS].join("|")})\\b`
);
function stringifyJsonValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

// components/ui/primitives/tool-call-block.tsx
var DEFAULT_STYLE = {
  Icon: import_lucide_react4.Wrench,
  text: "text-violet-300",
  chip: "bg-violet-500/15 text-violet-300",
  border: "border-violet-500/20"
};
var TOOL_STYLES = {
  bash: {
    Icon: import_lucide_react4.Terminal,
    text: "text-emerald-300",
    chip: "bg-emerald-500/15 text-emerald-300",
    border: "border-emerald-500/20"
  },
  read: {
    Icon: import_lucide_react4.FileText,
    text: "text-sky-300",
    chip: "bg-sky-500/15 text-sky-300",
    border: "border-sky-500/20"
  },
  write: {
    Icon: import_lucide_react4.FilePlus2,
    text: "text-violet-300",
    chip: "bg-violet-500/15 text-violet-300",
    border: "border-violet-500/20"
  },
  edit: {
    Icon: import_lucide_react4.FilePen,
    text: "text-amber-300",
    chip: "bg-amber-500/15 text-amber-300",
    border: "border-amber-500/20"
  },
  multiedit: {
    Icon: import_lucide_react4.FilePen,
    text: "text-amber-300",
    chip: "bg-amber-500/15 text-amber-300",
    border: "border-amber-500/20"
  },
  grep: {
    Icon: import_lucide_react4.Search,
    text: "text-cyan-300",
    chip: "bg-cyan-500/15 text-cyan-300",
    border: "border-cyan-500/20"
  },
  glob: {
    Icon: import_lucide_react4.FolderTree,
    text: "text-cyan-300",
    chip: "bg-cyan-500/15 text-cyan-300",
    border: "border-cyan-500/20"
  },
  webfetch: {
    Icon: import_lucide_react4.Globe,
    text: "text-blue-300",
    chip: "bg-blue-500/15 text-blue-300",
    border: "border-blue-500/20"
  },
  task: {
    Icon: import_lucide_react4.Bot,
    text: "text-pink-300",
    chip: "bg-pink-500/15 text-pink-300",
    border: "border-pink-500/20"
  },
  agent: {
    Icon: import_lucide_react4.Bot,
    text: "text-pink-300",
    chip: "bg-pink-500/15 text-pink-300",
    border: "border-pink-500/20"
  },
  todowrite: {
    Icon: import_lucide_react4.ListTodo,
    text: "text-rose-300",
    chip: "bg-rose-500/15 text-rose-300",
    border: "border-rose-500/20"
  },
  skill: {
    Icon: import_lucide_react4.Sparkles,
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
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 text-[11px] text-muted-foreground" }, /* @__PURE__ */ React.createElement(import_lucide_react4.FileText, { className: "size-3.5" }), /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, input.file_path)), typeof input.old_string === "string" ? /* @__PURE__ */ React.createElement(
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
  const [expanded, setExpanded] = (0, import_react2.useState)(false);
  const summary = buildSummary(toolUse);
  const style = styleForTool(toolUse.name);
  const Icon = style.Icon;
  let statusBadge = null;
  if (toolResult?.isError) {
    statusBadge = /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1 rounded border border-red-500/25 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-200 uppercase tracking-[0.12em]" }, /* @__PURE__ */ React.createElement(import_lucide_react4.AlertCircle, { className: "size-3" }), "error");
  } else if (toolResult) {
    statusBadge = /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1 rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-200 uppercase tracking-[0.12em]" }, /* @__PURE__ */ React.createElement(import_lucide_react4.CheckCircle2, { className: "size-3" }), "complete");
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
        import_lucide_react4.ChevronRight,
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ToolCallBlock
});
//# sourceMappingURL=tool-call-block.js.map