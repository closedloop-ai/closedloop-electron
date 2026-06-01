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

// components/ui/composites/session-table.tsx
var session_table_exports = {};
__export(session_table_exports, {
  SessionTable: () => SessionTable
});
module.exports = __toCommonJS(session_table_exports);

// components/ui/chip.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/chip.tsx
var chipVariants = (0, import_class_variance_authority.cva)(
  "inline-flex max-w-full items-center justify-center gap-1 rounded-full border font-medium whitespace-nowrap shrink-0 transition-[color,box-shadow,background-color] overflow-hidden [&>svg]:shrink-0 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-destructive/25 bg-destructive/12 text-destructive",
        success: "border-success/25 bg-success/12 text-success",
        warning: "border-warning/30 bg-warning/14 text-warning-foreground",
        info: "border-info/25 bg-info/12 text-info",
        accent: "border-primary/20 bg-primary/10 text-primary",
        muted: "border-border bg-muted/70 text-muted-foreground",
        outline: "border-input-border bg-input text-foreground"
      },
      size: {
        sm: "h-5 px-1.5 text-[11px] [&>svg]:size-3",
        default: "h-6 px-2.5 text-xs [&>svg]:size-3.5",
        lg: "h-7 px-3 text-sm [&>svg]:size-4"
      },
      interactive: {
        true: "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none [a&]:hover:bg-muted [button&]:hover:bg-muted",
        false: ""
      }
    },
    defaultVariants: {
      variant: "muted",
      size: "default",
      interactive: false
    }
  }
);
function Chip({
  className,
  variant,
  size,
  interactive,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? import_radix_ui.Slot.Slot : "span";
  return /* @__PURE__ */ React2.createElement(
    Comp,
    {
      className: cn(chipVariants({ variant, size, interactive }), className),
      "data-slot": "chip",
      ...props
    }
  );
}

// components/ui/table.tsx
var React3 = __toESM(require("react"));
function Table({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "div",
    {
      "data-slot": "table-container",
      className: "relative w-full overflow-x-auto"
    },
    /* @__PURE__ */ React3.createElement(
      "table",
      {
        "data-slot": "table",
        className: cn("w-full caption-bottom text-sm", className),
        ...props
      }
    )
  );
}
function TableHeader({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "thead",
    {
      "data-slot": "table-header",
      className: cn("[&_tr]:border-b", className),
      ...props
    }
  );
}
function TableBody({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "tbody",
    {
      "data-slot": "table-body",
      className: cn("[&_tr:last-child]:border-0", className),
      ...props
    }
  );
}
function TableRow({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "tr",
    {
      "data-slot": "table-row",
      className: cn(
        "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        className
      ),
      ...props
    }
  );
}
function TableHead({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "th",
    {
      "data-slot": "table-head",
      className: cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      ),
      ...props
    }
  );
}
function TableCell({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "td",
    {
      "data-slot": "table-cell",
      className: cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      ),
      ...props
    }
  );
}

// components/ui/composites/session-table.tsx
var import_lucide_react = require("lucide-react");

// components/ui/badge.tsx
var React4 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_class_variance_authority2 = require("class-variance-authority");
var badgeVariants = (0, import_class_variance_authority2.cva)(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive: "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        success: "border-success/25 bg-success/12 text-success [a&]:hover:bg-success/18",
        warning: "border-warning/30 bg-warning/14 text-warning-foreground [a&]:hover:bg-warning/20",
        info: "border-info/25 bg-info/12 text-info [a&]:hover:bg-info/18",
        accent: "border-primary/20 bg-primary/10 text-primary [a&]:hover:bg-primary/16",
        muted: "border-border bg-muted/70 text-muted-foreground [a&]:hover:bg-muted",
        outline: "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);
function Badge({
  className,
  variant,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? import_radix_ui2.Slot.Slot : "span";
  return /* @__PURE__ */ React4.createElement(
    Comp,
    {
      "data-slot": "badge",
      className: cn(badgeVariants({ variant }), className),
      ...props
    }
  );
}

// components/ui/primitives/status-badge.tsx
var sessionStatusConfig = {
  active: { label: "Active", tone: "success", pulse: true },
  waiting: { label: "Waiting", tone: "accent", pulse: true },
  completed: { label: "Completed", tone: "muted" },
  error: { label: "Error", tone: "danger" },
  abandoned: { label: "Abandoned", tone: "warning" }
};
var toneClasses = {
  default: "border-input-border bg-input text-foreground",
  success: "border-success/25 bg-success/12 text-success",
  warning: "border-warning/30 bg-warning/14 text-warning-foreground",
  danger: "border-destructive/25 bg-destructive/12 text-destructive",
  info: "border-info/25 bg-info/12 text-info",
  accent: "border-primary/20 bg-primary/10 text-primary",
  muted: "border-border bg-muted/70 text-muted-foreground"
};
var harnessConfig = {
  claude: { label: "Claude", tone: "accent" },
  codex: { label: "Codex", tone: "info" },
  cursor: { label: "Cursor", tone: "warning" },
  copilot: { label: "Copilot", tone: "success" },
  opencode: { label: "OpenCode", tone: "danger" }
};
function resolveSessionStatusConfig(status) {
  if (status in sessionStatusConfig) {
    return sessionStatusConfig[status];
  }
  if (status === "failed") {
    return { label: "Failed", tone: "danger" };
  }
  return {
    label: status.replace(/[-_]/g, " "),
    tone: "danger"
  };
}
function ToneBadge({
  label,
  tone = "default",
  pulse = false,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    Badge,
    {
      className: cn(
        "h-6 gap-1.5 rounded-full px-2.5 font-semibold text-[11px] tracking-[0.01em]",
        toneClasses[tone],
        className
      ),
      variant: "outline"
    },
    /* @__PURE__ */ React.createElement(
      "span",
      {
        "aria-hidden": "true",
        className: cn(
          "size-1.5 rounded-full bg-current",
          pulse && "animate-[pulse_1.6s_ease-in-out_infinite]"
        )
      }
    ),
    label
  );
}
function SessionStatusBadge({
  status
}) {
  const config = resolveSessionStatusConfig(status);
  return /* @__PURE__ */ React.createElement(
    ToneBadge,
    {
      label: config.label,
      pulse: config.pulse,
      tone: config.tone
    }
  );
}
function HarnessBadge({
  harness
}) {
  const config = harnessConfig[(harness || "claude").toLowerCase()] || {
    label: harness || "Claude",
    tone: "accent"
  };
  return /* @__PURE__ */ React.createElement(ToneBadge, { label: config.label, tone: config.tone });
}

// components/ui/utils.ts
function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}
function formatRelativeLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 6e4);
  const absoluteMinutes = Math.abs(diffMinutes);
  if (absoluteMinutes < 1) {
    return "just now";
  }
  if (absoluteMinutes < 60) {
    return `${absoluteMinutes}m ${diffMinutes >= 0 ? "from now" : "ago"}`;
  }
  const absoluteHours = Math.round(absoluteMinutes / 60);
  if (absoluteHours < 24) {
    return `${absoluteHours}h ${diffMinutes >= 0 ? "from now" : "ago"}`;
  }
  const absoluteDays = Math.round(absoluteHours / 24);
  return `${absoluteDays}d ${diffMinutes >= 0 ? "from now" : "ago"}`;
}
function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
function truncateMiddle(value, max = 32) {
  if (value.length <= max) {
    return value;
  }
  const visible = max - 3;
  if (visible <= 0) {
    return "...";
  }
  const head = Math.ceil(visible / 2);
  const tail = Math.floor(visible / 2);
  const suffix = tail > 0 ? value.slice(-tail) : "";
  return `${value.slice(0, head)}...${suffix}`;
}
function formatTokenCount(count) {
  const BILLION = 1e9;
  const MILLION = 1e6;
  const THOUSAND = 1e3;
  if (count >= BILLION) {
    return `${(count / BILLION).toFixed(2)}B`;
  }
  if (count >= MILLION) {
    const divided = count / MILLION;
    if (divided >= 999.995) {
      return `${(count / BILLION).toFixed(2)}B`;
    }
    return `${divided.toFixed(2)}M`;
  }
  if (count >= THOUSAND) {
    const divided = count / THOUSAND;
    if (divided >= 999.995) {
      return `${(count / MILLION).toFixed(2)}M`;
    }
    return `${divided.toFixed(2)}k`;
  }
  return count.toString();
}
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

// components/ui/composites/session-table.tsx
function SessionTable({
  rows,
  emptyState,
  getSessionHref,
  renderSessionLink,
  extraColumnLabel,
  renderExtraColumn
}) {
  if (rows.length === 0) {
    return emptyState ?? /* @__PURE__ */ React.createElement("div", { className: "px-6 py-12 text-center text-muted-foreground text-sm" }, "No sessions match the current filters.");
  }
  return /* @__PURE__ */ React.createElement(Table, null, /* @__PURE__ */ React.createElement(TableHeader, { className: "bg-muted/30" }, /* @__PURE__ */ React.createElement(TableRow, null, /* @__PURE__ */ React.createElement(TableHead, null, "Session"), /* @__PURE__ */ React.createElement(TableHead, null, "Status"), /* @__PURE__ */ React.createElement(TableHead, null, "Last activity"), /* @__PURE__ */ React.createElement(TableHead, null, "Duration"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Tokens"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Agents"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Cost"), /* @__PURE__ */ React.createElement(TableHead, null, "Directory"), extraColumnLabel ? /* @__PURE__ */ React.createElement(TableHead, null, extraColumnLabel) : null)), /* @__PURE__ */ React.createElement(TableBody, null, rows.map((row) => {
    const href = getSessionHref?.(row);
    return /* @__PURE__ */ React.createElement(TableRow, { key: row.id }, /* @__PURE__ */ React.createElement(TableCell, { className: "align-top" }, /* @__PURE__ */ React.createElement("div", { className: "flex min-w-[14rem] flex-col gap-2" }, /* @__PURE__ */ React.createElement("div", { className: "font-medium" }, renderSessionLink ? renderSessionLink(row) : href ? /* @__PURE__ */ React.createElement("a", { className: "hover:underline", href }, row.name) : row.name), /* @__PURE__ */ React.createElement("div", { className: "font-mono text-[11px] text-muted-foreground" }, row.id.slice(0, 12)), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-2" }, /* @__PURE__ */ React.createElement(HarnessBadge, { harness: row.harness }), /* @__PURE__ */ React.createElement(Chip, { variant: "outline" }, row.model), row.isRunDriven ? /* @__PURE__ */ React.createElement(Chip, { asChild: true, interactive: true, variant: "success" }, /* @__PURE__ */ React.createElement("a", { href: row.runHref || "#" }, /* @__PURE__ */ React.createElement(import_lucide_react.Play, { className: "size-3" }), "Run")) : null, row.awaitingInputSince ? /* @__PURE__ */ React.createElement(
      ToneBadge,
      {
        label: "Awaiting input",
        pulse: true,
        tone: "accent"
      }
    ) : null))), /* @__PURE__ */ React.createElement(TableCell, { className: "align-top" }, /* @__PURE__ */ React.createElement(SessionStatusBadge, { status: row.status })), /* @__PURE__ */ React.createElement(TableCell, { className: "align-top" }, /* @__PURE__ */ React.createElement("div", { className: "text-sm" }, formatRelativeLabel(row.lastActivity)), /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-xs" }, formatDateTime(row.lastActivity))), /* @__PURE__ */ React.createElement(TableCell, { className: "align-top font-mono text-xs" }, row.durationLabel || "Running"), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right align-top tabular-nums" }, row.totalTokens == null ? "\u2014" : formatTokenCount(row.totalTokens)), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right align-top tabular-nums" }, row.agents), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right align-top tabular-nums" }, formatCurrency(row.cost)), /* @__PURE__ */ React.createElement(TableCell, { className: "align-top" }, /* @__PURE__ */ React.createElement("div", { className: "font-medium text-sm" }, truncateMiddle(row.repo, 36)), /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-xs" }, "Started ", formatDateTime(row.startedAt))), extraColumnLabel ? /* @__PURE__ */ React.createElement(TableCell, { className: "align-top" }, renderExtraColumn?.(row) ?? null) : null);
  })));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SessionTable
});
//# sourceMappingURL=session-table.js.map