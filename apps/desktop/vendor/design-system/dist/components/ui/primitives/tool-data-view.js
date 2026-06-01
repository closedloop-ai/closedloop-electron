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

// components/ui/primitives/tool-data-view.tsx
var tool_data_view_exports = {};
__export(tool_data_view_exports, {
  ToolInputView: () => ToolInputView,
  ToolResponseView: () => ToolResponseView
});
module.exports = __toCommonJS(tool_data_view_exports);

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

// components/ui/primitives/file-list.tsx
var import_lucide_react3 = require("lucide-react");
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
    /* @__PURE__ */ React.createElement(import_lucide_react3.FolderOpen, { className: "size-3.5 shrink-0 text-muted-foreground" }),
    /* @__PURE__ */ React.createElement("span", { className: "break-all font-mono text-[11px] text-foreground" }, path)
  )))));
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

// components/ui/primitives/match-list.tsx
var import_lucide_react4 = require("lucide-react");
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
    /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 text-[11px]" }, /* @__PURE__ */ React.createElement(import_lucide_react4.Search, { className: "size-3.5 shrink-0 text-muted-foreground" }), match.file ? /* @__PURE__ */ React.createElement("span", { className: "break-all font-mono text-foreground" }, match.file) : null, typeof match.line === "number" ? /* @__PURE__ */ React.createElement("span", { className: "rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground" }, match.line) : null),
    match.text ? /* @__PURE__ */ React.createElement("pre", { className: "mt-2 whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground" }, match.text) : null
  )))));
}

// components/ui/primitives/terminal-block.tsx
var import_lucide_react5 = require("lucide-react");
function TerminalBlock({
  command,
  description,
  label = "terminal",
  text,
  stream
}) {
  const body = text ?? [description ? `# ${description}` : null, command ? `$ ${command}` : null].filter(Boolean).join("\n");
  const isErrorStream = stream === "stderr";
  return /* @__PURE__ */ React.createElement("div", { className: "overflow-hidden rounded-xl border border-border/70 bg-zinc-950/95 shadow-sm" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between border-border/60 border-b bg-black/30 px-3 py-1.5" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1.5 text-[10px] text-zinc-400 uppercase tracking-[0.12em]" }, /* @__PURE__ */ React.createElement(import_lucide_react5.Terminal, { className: "size-3" }), /* @__PURE__ */ React.createElement("span", null, stream ?? label)), /* @__PURE__ */ React.createElement(CopyButton, { label: "Copy", text: body })), /* @__PURE__ */ React.createElement(
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

// components/ui/primitives/tool-data-view.tsx
function str(value) {
  return typeof value === "string" ? value : "";
}
function obj(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return null;
}
function isMcp(toolName) {
  return toolName.startsWith("mcp__");
}
function diffFromStrings(oldValue, newValue) {
  if (!oldValue && !newValue) {
    return [];
  }
  const oldLines = oldValue ? oldValue.split(/\r?\n/) : [];
  const newLines = newValue ? newValue.split(/\r?\n/) : [];
  const lines = [
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`)
  ];
  return [
    {
      oldStart: 1,
      newStart: 1,
      oldLines: oldLines.length,
      newLines: newLines.length,
      lines
    }
  ];
}
function parseStructuredPatch(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    const patch = obj(entry);
    if (!patch) {
      return null;
    }
    const lines = Array.isArray(patch.lines) ? patch.lines.filter((line) => typeof line === "string") : [];
    return {
      oldStart: typeof patch.oldStart === "number" ? patch.oldStart : 1,
      newStart: typeof patch.newStart === "number" ? patch.newStart : 1,
      oldLines: typeof patch.oldLines === "number" ? patch.oldLines : lines.length,
      newLines: typeof patch.newLines === "number" ? patch.newLines : lines.length,
      lines
    };
  }).filter((entry) => entry !== null);
}
function toMatch(raw) {
  if (typeof raw === "string") {
    const match = raw.match(/^(.+?):(\d+):(.*)$/);
    if (match) {
      return {
        file: match[1],
        line: Number(match[2]),
        text: match[3]
      };
    }
    return { text: raw };
  }
  const record = obj(raw);
  if (!record) {
    return null;
  }
  const next = {};
  if (typeof record.file === "string") {
    next.file = record.file;
  } else if (typeof record.path === "string") {
    next.file = record.path;
  }
  if (typeof record.line === "number") {
    next.line = record.line;
  } else if (typeof record.line_number === "number") {
    next.line = record.line_number;
  }
  if (typeof record.text === "string") {
    next.text = record.text;
  } else if (typeof record.match === "string") {
    next.text = record.match;
  } else if (typeof record.content === "string") {
    next.text = record.content;
  }
  return next;
}
function parseGrepMatches(value) {
  if (Array.isArray(value)) {
    return value.map(toMatch).filter((entry) => entry !== null);
  }
  const record = obj(value);
  if (!record) {
    return [];
  }
  if (Array.isArray(record.matches)) {
    return record.matches.map(toMatch).filter((entry) => entry !== null);
  }
  if (Array.isArray(record.files)) {
    return record.files.filter((file) => typeof file === "string").map((file) => ({ file }));
  }
  return [];
}
function parseFileList(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string");
  }
  const record = obj(value);
  if (!record) {
    return [];
  }
  if (Array.isArray(record.files)) {
    return record.files.filter((entry) => typeof entry === "string");
  }
  if (Array.isArray(record.paths)) {
    return record.paths.filter((entry) => typeof entry === "string");
  }
  return [];
}
function ToolInputView({
  toolName,
  input
}) {
  if (!toolName) {
    return null;
  }
  const record = obj(input);
  if (!record) {
    return null;
  }
  if (isMcp(toolName)) {
    return /* @__PURE__ */ React.createElement(KeyValueGrid, { data: record });
  }
  switch (toolName) {
    case "Bash":
    case "PowerShell": {
      const command = str(record.command);
      if (!command) {
        return null;
      }
      return /* @__PURE__ */ React.createElement(
        TerminalBlock,
        {
          command,
          description: str(record.description) || void 0
        }
      );
    }
    case "Read": {
      const path = str(record.file_path);
      const flags = [
        record.offset != null ? `--offset=${record.offset}` : null,
        record.limit != null ? `--limit=${record.limit}` : null
      ].filter(Boolean);
      if (!path) {
        return null;
      }
      return /* @__PURE__ */ React.createElement(TerminalBlock, { command: `read ${path}${flags.length ? ` ${flags.join(" ")}` : ""}` });
    }
    case "Write": {
      return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, str(record.file_path) ? /* @__PURE__ */ React.createElement(TerminalBlock, { command: `write ${str(record.file_path)}` }) : null, str(record.content) ? /* @__PURE__ */ React.createElement(
        CodeBlock,
        {
          code: str(record.content),
          label: "content",
          showLineNumbers: true
        }
      ) : null);
    }
    case "Edit":
    case "NotebookEdit": {
      const hunks = diffFromStrings(str(record.old_string), str(record.new_string));
      return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, str(record.file_path) ? /* @__PURE__ */ React.createElement(
        TerminalBlock,
        {
          command: `edit ${str(record.file_path)}${record.replace_all === true ? " --replace-all" : ""}`
        }
      ) : null, hunks.length > 0 ? /* @__PURE__ */ React.createElement(UnifiedDiff, { hunks }) : null);
    }
    case "Grep": {
      const pattern = str(record.pattern);
      const path = str(record.path);
      const flags = [
        record.glob ? `--glob=${str(record.glob)}` : null,
        record.type ? `--type=${str(record.type)}` : null,
        record.output_mode ? `--mode=${str(record.output_mode)}` : null,
        record["-i"] ? "-i" : null,
        record["-n"] ? "-n" : null
      ].filter(Boolean);
      return /* @__PURE__ */ React.createElement(
        TerminalBlock,
        {
          command: `grep "${pattern}"${path ? ` ${path}` : ""}${flags.length ? ` ${flags.join(" ")}` : ""}`
        }
      );
    }
    case "Glob":
      return /* @__PURE__ */ React.createElement(
        TerminalBlock,
        {
          command: `glob "${str(record.pattern)}"${str(record.path) ? ` ${str(record.path)}` : ""}`
        }
      );
    case "WebFetch":
      return /* @__PURE__ */ React.createElement(
        TerminalBlock,
        {
          command: `fetch ${str(record.url)}`,
          description: str(record.prompt) || void 0
        }
      );
    case "Task":
    case "Agent":
      return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement(
        KeyValueGrid,
        {
          data: {
            ...str(record.description) ? { description: str(record.description) } : {},
            ...str(record.subagent_type) ? { subagent_type: str(record.subagent_type) } : {}
          }
        }
      ), str(record.prompt) ? /* @__PURE__ */ React.createElement(
        CodeBlock,
        {
          code: str(record.prompt),
          label: "prompt",
          maxHeight: "16rem",
          showLineNumbers: true
        }
      ) : null);
    case "AskUserQuestion": {
      if (!Array.isArray(record.questions)) {
        return null;
      }
      return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, record.questions.map((question, index) => {
        const value = obj(question);
        if (!value) {
          return null;
        }
        return /* @__PURE__ */ React.createElement(
          KeyValueGrid,
          {
            data: value,
            key: `question-${index}`
          }
        );
      }));
    }
    default:
      return null;
  }
}
function ToolResponseView({
  toolName,
  response
}) {
  if (!toolName) {
    return null;
  }
  if (isMcp(toolName)) {
    const record = obj(response);
    return record ? /* @__PURE__ */ React.createElement(KeyValueGrid, { data: record }) : null;
  }
  switch (toolName) {
    case "Bash":
    case "PowerShell": {
      const record = obj(response);
      if (!record) {
        return null;
      }
      const stdout = str(record.stdout);
      const stderr = str(record.stderr);
      const exitCode = typeof record.exitCode === "number" ? `exit ${record.exitCode}` : null;
      return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, stdout ? /* @__PURE__ */ React.createElement(TerminalBlock, { stream: "stdout", text: stdout }) : null, stderr ? /* @__PURE__ */ React.createElement(TerminalBlock, { stream: "stderr", text: stderr }) : null, record.interrupted === true ? /* @__PURE__ */ React.createElement(CodeBlock, { code: "interrupted", compact: true, tone: "danger" }) : null, !record.interrupted && exitCode ? /* @__PURE__ */ React.createElement(CodeBlock, { code: exitCode, compact: true, tone: "danger" }) : null);
    }
    case "Edit":
    case "NotebookEdit": {
      const record = obj(response);
      if (!record) {
        return null;
      }
      const hunks = parseStructuredPatch(record.structuredPatch);
      return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, hunks.length > 0 ? /* @__PURE__ */ React.createElement(UnifiedDiff, { hunks }) : null, str(record.originalFile) ? /* @__PURE__ */ React.createElement(
        CodeBlock,
        {
          code: str(record.originalFile),
          label: "original file",
          maxHeight: "24rem",
          showLineNumbers: true
        }
      ) : null);
    }
    case "Read": {
      if (typeof response === "string") {
        return /* @__PURE__ */ React.createElement(CodeBlock, { code: response, showLineNumbers: true });
      }
      const record = obj(response);
      return record && typeof record.content === "string" ? /* @__PURE__ */ React.createElement(CodeBlock, { code: record.content, showLineNumbers: true }) : null;
    }
    case "Write": {
      const record = obj(response);
      return record ? /* @__PURE__ */ React.createElement(KeyValueGrid, { data: record }) : null;
    }
    case "Grep": {
      const matches = parseGrepMatches(response);
      return matches.length > 0 ? /* @__PURE__ */ React.createElement(MatchList, { matches }) : null;
    }
    case "Glob": {
      const files = parseFileList(response);
      return files.length > 0 ? /* @__PURE__ */ React.createElement(FileList, { paths: files }) : null;
    }
    case "WebFetch": {
      if (typeof response === "string") {
        return /* @__PURE__ */ React.createElement(CodeBlock, { code: response, showLineNumbers: true });
      }
      const record = obj(response);
      if (!record) {
        return null;
      }
      if (typeof record.content === "string") {
        return /* @__PURE__ */ React.createElement(CodeBlock, { code: record.content, showLineNumbers: true });
      }
      return /* @__PURE__ */ React.createElement(KeyValueGrid, { data: record });
    }
    case "Task":
    case "Agent": {
      if (typeof response === "string") {
        return /* @__PURE__ */ React.createElement(CodeBlock, { code: response, label: "output", showLineNumbers: true });
      }
      const record = obj(response);
      return record ? /* @__PURE__ */ React.createElement(KeyValueGrid, { data: record }) : null;
    }
    case "AskUserQuestion": {
      const record = obj(response);
      return record ? /* @__PURE__ */ React.createElement(KeyValueGrid, { data: record }) : null;
    }
    default:
      return null;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ToolInputView,
  ToolResponseView
});
//# sourceMappingURL=tool-data-view.js.map