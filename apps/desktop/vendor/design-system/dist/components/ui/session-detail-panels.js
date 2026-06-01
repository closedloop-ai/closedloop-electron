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

// components/ui/session-detail-panels.tsx
var session_detail_panels_exports = {};
__export(session_detail_panels_exports, {
  JsonPanel: () => JsonPanel,
  SessionAgentsSection: () => SessionAgentsSection,
  SessionAttributionPanel: () => SessionAttributionPanel,
  SessionErrorDetailsPanel: () => SessionErrorDetailsPanel,
  SessionMetadataPanel: () => SessionMetadataPanel,
  SessionModelUsageTable: () => SessionModelUsageTable,
  SessionOverviewSection: () => SessionOverviewSection,
  SessionSummaryMetrics: () => SessionSummaryMetrics,
  SessionTimelineSection: () => SessionTimelineSection,
  SessionToolInvocationsPanel: () => SessionToolInvocationsPanel
});
module.exports = __toCommonJS(session_detail_panels_exports);
var import_lucide_react3 = require("lucide-react");

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

// components/ui/empty.tsx
var import_class_variance_authority2 = require("class-variance-authority");
function Empty({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty",
      className: cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg border-dashed p-6 text-center text-balance md:p-12",
        className
      ),
      ...props
    }
  );
}
function EmptyHeader({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-header",
      className: cn(
        "flex max-w-sm flex-col items-center gap-2 text-center",
        className
      ),
      ...props
    }
  );
}
var emptyMediaVariants = (0, import_class_variance_authority2.cva)(
  "flex shrink-0 items-center justify-center mb-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg:not([class*='size-'])]:size-6"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);
function EmptyMedia({
  className,
  variant = "default",
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-icon",
      "data-variant": variant,
      className: cn(emptyMediaVariants({ variant, className })),
      ...props
    }
  );
}
function EmptyTitle({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-title",
      className: cn("text-lg font-medium tracking-tight", className),
      ...props
    }
  );
}
function EmptyDescription({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-description",
      className: cn(
        "text-muted-foreground [&>a:hover]:text-primary text-sm/relaxed [&>a]:underline [&>a]:underline-offset-4",
        className
      ),
      ...props
    }
  );
}
function EmptyContent({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-content",
      className: cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance",
        className
      ),
      ...props
    }
  );
}

// components/ui/empty-state.tsx
function EmptyState({
  icon: Icon,
  title,
  description,
  className,
  action
}) {
  return /* @__PURE__ */ React.createElement(Empty, { className: cn("py-12", className) }, /* @__PURE__ */ React.createElement(EmptyHeader, null, /* @__PURE__ */ React.createElement(EmptyMedia, { variant: "icon" }, /* @__PURE__ */ React.createElement(Icon, { className: "size-6" })), /* @__PURE__ */ React.createElement(EmptyTitle, null, title), description ? /* @__PURE__ */ React.createElement(EmptyDescription, null, description) : null), action ? /* @__PURE__ */ React.createElement(EmptyContent, null, action) : null);
}

// components/ui/card.tsx
var React3 = __toESM(require("react"));
function Card({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "div",
    {
      "data-slot": "card",
      className: cn(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
        className
      ),
      ...props
    }
  );
}
function CardHeader({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "div",
    {
      "data-slot": "card-header",
      className: cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      ),
      ...props
    }
  );
}
function CardTitle({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "div",
    {
      "data-slot": "card-title",
      className: cn("leading-none font-semibold", className),
      ...props
    }
  );
}
function CardDescription({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "div",
    {
      "data-slot": "card-description",
      className: cn("text-muted-foreground text-sm", className),
      ...props
    }
  );
}
function CardContent({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "div",
    {
      "data-slot": "card-content",
      className: cn("px-6", className),
      ...props
    }
  );
}

// components/ui/layout/section.tsx
function Section({
  title,
  description,
  actions,
  children,
  className,
  contentClassName
}) {
  return /* @__PURE__ */ React.createElement(Card, { className: cn("border-border/80 bg-card/95 shadow-sm", className) }, /* @__PURE__ */ React.createElement(CardHeader, { className: "flex flex-row items-start justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, /* @__PURE__ */ React.createElement(CardTitle, null, title), description ? /* @__PURE__ */ React.createElement(CardDescription, null, description) : null), actions), /* @__PURE__ */ React.createElement(CardContent, { className: contentClassName }, children));
}

// components/ui/badge.tsx
var React4 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_class_variance_authority3 = require("class-variance-authority");
var badgeVariants = (0, import_class_variance_authority3.cva)(
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

// components/ui/primitives/agent-card.tsx
var import_lucide_react = require("lucide-react");

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

// components/ui/primitives/status-badge.tsx
var agentStatusConfig = {
  working: { label: "Working", tone: "success", pulse: true },
  waiting: { label: "Waiting", tone: "accent", pulse: true },
  completed: { label: "Completed", tone: "muted" },
  error: { label: "Error", tone: "danger" },
  idle: { label: "Idle", tone: "default" }
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
function resolveAgentStatusConfig(status) {
  if (status in agentStatusConfig) {
    return agentStatusConfig[status];
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
function AgentStatusBadge({
  status
}) {
  const config = resolveAgentStatusConfig(status);
  return /* @__PURE__ */ React.createElement(
    ToneBadge,
    {
      label: config.label,
      pulse: config.pulse,
      tone: config.tone
    }
  );
}

// components/ui/primitives/agent-card.tsx
function AgentCard({
  agent,
  active = false,
  className
}) {
  const isMain = agent.type === "main";
  const isWaiting = agent.status === "waiting";
  const isWorking = agent.status === "working";
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "rounded-xl border bg-card p-3 shadow-sm transition-colors",
        isWaiting ? "border-l-2 border-l-warning" : isWorking ? "border-l-2 border-l-success" : "border-border/80",
        active && "border-primary/35 bg-primary/8 ring-1 ring-primary/20",
        !active && "hover:border-border",
        className
      )
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-start justify-between gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex min-w-0 items-start gap-3" }, /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
          isMain ? "bg-primary/12 text-primary" : "bg-violet-500/12 text-violet-400"
        )
      },
      isMain ? /* @__PURE__ */ React.createElement(import_lucide_react.Bot, { className: "size-4" }) : /* @__PURE__ */ React.createElement(import_lucide_react.GitBranch, { className: "size-4" })
    ), /* @__PURE__ */ React.createElement("div", { className: "min-w-0 space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement("p", { className: "truncate font-medium text-sm" }, agent.name), agent.subagentType ? /* @__PURE__ */ React.createElement(Badge, { className: "font-mono text-[10px]", variant: "outline" }, agent.subagentType) : null), agent.label ? /* @__PURE__ */ React.createElement("p", { className: "truncate text-muted-foreground text-xs" }, agent.label) : null)), /* @__PURE__ */ React.createElement(AgentStatusBadge, { status: agent.status })),
    agent.task ? /* @__PURE__ */ React.createElement("p", { className: "mt-3 line-clamp-2 text-muted-foreground text-xs leading-relaxed" }, agent.task) : null,
    /* @__PURE__ */ React.createElement("div", { className: "mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" }, agent.currentTool ? /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1" }, /* @__PURE__ */ React.createElement(import_lucide_react.Wrench, { className: "size-3" }), /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, agent.currentTool)) : null, agent.model ? /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1" }, /* @__PURE__ */ React.createElement(import_lucide_react.Cpu, { className: "size-3" }), agent.model) : null, typeof agent.cost === "number" && agent.cost > 0 ? /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1" }, /* @__PURE__ */ React.createElement(import_lucide_react.Coins, { className: "size-3" }), formatCurrency(agent.cost)) : null, /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1" }, /* @__PURE__ */ React.createElement(import_lucide_react.Clock3, { className: "size-3" }), formatRelativeLabel(
      agent.updatedAt || agent.endedAt || agent.startedAt
    ))),
    /* @__PURE__ */ React.createElement("div", { className: "mt-2 text-[11px] text-muted-foreground" }, "Started ", formatDateTime(agent.startedAt))
  );
}

// components/ui/button.tsx
var React5 = __toESM(require("react"));
var import_radix_ui3 = require("radix-ui");
var import_class_variance_authority4 = require("class-variance-authority");
var buttonVariants = (0, import_class_variance_authority4.cva)(
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
  const Comp = asChild ? import_radix_ui3.Slot.Slot : "button";
  return /* @__PURE__ */ React5.createElement(
    Comp,
    {
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size, className })),
      ...props
    }
  );
}

// components/ui/primitives/event-group-row.tsx
var import_lucide_react2 = require("lucide-react");
var import_react = require("react");
function EventGroupRow({
  group,
  defaultExpanded = false
}) {
  const [expanded, setExpanded] = (0, import_react.useState)(defaultExpanded);
  const first = group.events[0];
  const statuses = group.events.reduce((sequence, event) => {
    if (sequence[sequence.length - 1] !== event.status) {
      sequence.push(event.status);
    }
    return sequence;
  }, []);
  const isMultiEvent = group.events.length > 1;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm",
        isMultiEvent && "border-l-2 border-l-cyan-500/40"
      )
    },
    /* @__PURE__ */ React.createElement(
      "button",
      {
        className: cn(
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/35",
          isMultiEvent && "bg-cyan-500/[0.03] hover:bg-cyan-500/[0.06]"
        ),
        onClick: () => setExpanded((value) => !value),
        type: "button"
      },
      /* @__PURE__ */ React.createElement(
        import_lucide_react2.ChevronRight,
        {
          className: cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )
        }
      ),
      /* @__PURE__ */ React.createElement("div", { className: "min-w-0 flex-1 space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement("p", { className: "truncate font-medium text-sm" }, group.title), first?.toolName ? /* @__PURE__ */ React.createElement("span", { className: "font-mono text-[11px] text-muted-foreground" }, first.toolName) : null, isMultiEvent ? /* @__PURE__ */ React.createElement("span", { className: "font-mono text-[11px] text-muted-foreground" }, group.events.length, " events") : null), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground" }, /* @__PURE__ */ React.createElement("span", null, formatDateTime(first.createdAt)), group.durationLabel ? /* @__PURE__ */ React.createElement("span", null, group.durationLabel) : null, first.agentLabel ? /* @__PURE__ */ React.createElement("span", null, first.agentLabel) : null, first.project ? /* @__PURE__ */ React.createElement("span", null, first.project) : null)),
      /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 flex-wrap items-center justify-end gap-1" }, statuses.map((status, index) => /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1", key: `${status}-${index}` }, index > 0 ? /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-muted-foreground" }, "\u2192") : null, /* @__PURE__ */ React.createElement(AgentStatusBadge, { status }))))
    ),
    expanded ? /* @__PURE__ */ React.createElement("div", { className: "border-border/70 border-t bg-muted/15 px-4 py-3" }, isMultiEvent ? /* @__PURE__ */ React.createElement("div", { className: "mb-3 font-medium text-[10px] text-muted-foreground uppercase tracking-[0.12em]" }, group.events.length, " grouped events") : null, /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, group.events.map((event) => /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "rounded-lg border border-border/70 bg-background/70 p-3",
        key: event.id
      },
      /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement(AgentStatusBadge, { status: event.status }), /* @__PURE__ */ React.createElement("span", { className: "font-mono text-[11px] text-muted-foreground" }, event.eventType), /* @__PURE__ */ React.createElement("span", { className: "font-medium text-sm" }, event.title), /* @__PURE__ */ React.createElement("span", { className: "ml-auto text-[11px] text-muted-foreground" }, formatDateTime(event.createdAt))),
      event.summary ? /* @__PURE__ */ React.createElement("p", { className: "mt-2 text-muted-foreground text-sm" }, event.summary) : null,
      event.metadata?.length ? /* @__PURE__ */ React.createElement("div", { className: "mt-3 flex flex-wrap gap-2" }, event.metadata.map((item) => /* @__PURE__ */ React.createElement(
        Button,
        {
          className: "h-auto px-2 py-1 font-normal text-[11px]",
          key: `${event.id}-${item.label}`,
          variant: "outline"
        },
        /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground" }, item.label),
        /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, item.value)
      ))) : null,
      event.detail ? /* @__PURE__ */ React.createElement(EventDetailPanel, { event }) : null
    )))) : null
  );
}
function EventDetailPanel({ event }) {
  const detail = event.detail;
  if (!detail) {
    return null;
  }
  return /* @__PURE__ */ React.createElement("div", { className: "mt-3 space-y-3 rounded-lg border border-border/70 bg-muted/10 p-3" }, detail.summary ? /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("p", { className: "font-medium text-sm" }, detail.summary.headline), detail.summary.bullets?.length ? /* @__PURE__ */ React.createElement("ul", { className: "list-disc space-y-1 pl-5 text-muted-foreground text-sm" }, detail.summary.bullets.map((bullet) => /* @__PURE__ */ React.createElement("li", { key: bullet }, bullet))) : null) : null, detail.fields.length ? /* @__PURE__ */ React.createElement("dl", { className: "grid gap-2 md:grid-cols-2" }, detail.fields.map((field) => /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "rounded-md border border-border/60 bg-background/80 p-2",
      key: `${event.id}-${field.key}`
    },
    /* @__PURE__ */ React.createElement("dt", { className: "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground" }, field.label),
    /* @__PURE__ */ React.createElement("dd", { className: "mt-1 break-words font-mono text-xs text-foreground" }, formatJsonValue(field.value))
  ))) : null);
}
function formatJsonValue(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

// components/ui/primitives/metric-card.tsx
function MetricCard({
  label,
  value,
  detail,
  trend,
  icon: Icon,
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    Card,
    {
      className: cn(
        "border-border/80 bg-card/95 shadow-black/5 shadow-sm",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React.createElement(CardHeader, { className: "flex flex-row items-start justify-between gap-4 space-y-0 pb-3" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, /* @__PURE__ */ React.createElement(CardDescription, { className: "font-semibold text-[11px] uppercase tracking-[0.12em]" }, label), /* @__PURE__ */ React.createElement(CardTitle, { className: "font-semibold text-2xl tracking-tight" }, value)), Icon ? /* @__PURE__ */ React.createElement("span", { className: "flex size-9 items-center justify-center rounded-xl border border-primary/10 bg-primary/10 text-primary" }, /* @__PURE__ */ React.createElement(Icon, { className: "size-4" })) : null),
    (detail || trend) && /* @__PURE__ */ React.createElement(CardContent, { className: "flex items-center justify-between gap-3 pt-0" }, /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-sm" }, detail), trend ? /* @__PURE__ */ React.createElement("span", { className: "font-semibold text-primary text-xs" }, trend) : null)
  );
}

// components/ui/table.tsx
var React6 = __toESM(require("react"));
function Table({ className, ...props }) {
  return /* @__PURE__ */ React6.createElement(
    "div",
    {
      "data-slot": "table-container",
      className: "relative w-full overflow-x-auto"
    },
    /* @__PURE__ */ React6.createElement(
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
  return /* @__PURE__ */ React6.createElement(
    "thead",
    {
      "data-slot": "table-header",
      className: cn("[&_tr]:border-b", className),
      ...props
    }
  );
}
function TableBody({ className, ...props }) {
  return /* @__PURE__ */ React6.createElement(
    "tbody",
    {
      "data-slot": "table-body",
      className: cn("[&_tr:last-child]:border-0", className),
      ...props
    }
  );
}
function TableRow({ className, ...props }) {
  return /* @__PURE__ */ React6.createElement(
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
  return /* @__PURE__ */ React6.createElement(
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
  return /* @__PURE__ */ React6.createElement(
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

// components/ui/session-detail-panels.tsx
function SessionSummaryMetrics({
  metrics
}) {
  return /* @__PURE__ */ React.createElement("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4" }, metrics.map((metric) => /* @__PURE__ */ React.createElement(
    MetricCard,
    {
      detail: metric.detail,
      key: metric.label,
      label: metric.label,
      value: metric.value
    }
  )));
}
function SessionMetadataPanel({
  metadata,
  details = []
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-3 text-sm",
      title: "Session metadata",
      description: "Identity, ownership, and source metadata for the synced session."
    },
    /* @__PURE__ */ React.createElement("div", { className: "grid gap-3 md:grid-cols-2" }, metadata.map((item) => /* @__PURE__ */ React.createElement("div", { key: item.label }, /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground" }, item.label), /* @__PURE__ */ React.createElement("div", { className: "font-medium" }, item.value)))),
    details.length > 0 ? /* @__PURE__ */ React.createElement("div", { className: "space-y-2 border-t pt-3" }, details.map((item) => /* @__PURE__ */ React.createElement("div", { key: item.label }, /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground" }, item.label, ":"), " ", item.value))) : null
  );
}
function SessionAttributionPanel({
  value
}) {
  return /* @__PURE__ */ React.createElement(
    JsonPanel,
    {
      description: "Structured attribution received from the local desktop sync.",
      emptyMessage: "No attribution data was captured for this session.",
      title: "Attribution",
      value
    }
  );
}
function SessionModelUsageTable({
  rows
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-0",
      title: "Token usage by model",
      description: "Input, output, cache, and cost totals grouped by model."
    },
    rows.length === 0 ? /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-10",
        description: "No model usage rows were recorded for this session.",
        icon: import_lucide_react3.BotIcon,
        title: "No model usage"
      }
    ) : /* @__PURE__ */ React.createElement(Table, null, /* @__PURE__ */ React.createElement(TableHeader, null, /* @__PURE__ */ React.createElement(TableRow, null, /* @__PURE__ */ React.createElement(TableHead, null, "Model"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Input"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Output"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Cache Read"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Cache Write"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Cost"))), /* @__PURE__ */ React.createElement(TableBody, null, rows.map((row) => /* @__PURE__ */ React.createElement(TableRow, { key: row.model }, /* @__PURE__ */ React.createElement(TableCell, { className: "font-medium" }, row.model), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.inputTokens), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.outputTokens), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.cacheReadTokens), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.cacheWriteTokens), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.estimatedCost)))))
  );
}
function SessionToolInvocationsPanel({
  rows
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-0",
      description: "Distinct tools invoked during the session, grouped with counts and timing.",
      title: "Tool invocations"
    },
    rows.length === 0 ? /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-10",
        description: "No tool invocations were captured for this session.",
        icon: import_lucide_react3.WrenchIcon,
        title: "No tool activity"
      }
    ) : /* @__PURE__ */ React.createElement(Table, null, /* @__PURE__ */ React.createElement(TableHeader, null, /* @__PURE__ */ React.createElement(TableRow, null, /* @__PURE__ */ React.createElement(TableHead, null, "Tool"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Count"), /* @__PURE__ */ React.createElement(TableHead, null, "First Seen"), /* @__PURE__ */ React.createElement(TableHead, null, "Last Seen"))), /* @__PURE__ */ React.createElement(TableBody, null, rows.map((row) => /* @__PURE__ */ React.createElement(TableRow, { key: row.toolName }, /* @__PURE__ */ React.createElement(TableCell, { className: "font-medium" }, row.toolName), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.count), /* @__PURE__ */ React.createElement(TableCell, null, row.firstSeenAt), /* @__PURE__ */ React.createElement(TableCell, null, row.lastSeenAt)))))
  );
}
function SessionErrorDetailsPanel({
  errors
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-4",
      description: "API and session events flagged as errors.",
      title: "Error details"
    },
    errors.length === 0 ? /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-10",
        description: "No error events were captured for this session.",
        icon: import_lucide_react3.AlertCircleIcon,
        title: "No errors"
      }
    ) : errors.map((event) => /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "rounded-md border bg-muted/30 p-3",
        key: event.id
      },
      /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "font-medium" }, event.eventType), /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-xs" }, event.createdAt)),
      /* @__PURE__ */ React.createElement("div", { className: "mt-2 text-sm" }, event.summary),
      event.rawData ? /* @__PURE__ */ React.createElement("pre", { className: "mt-3 overflow-auto rounded-md bg-background p-2 text-xs" }, event.rawData) : null
    ))
  );
}
function SessionAgentsSection({
  agents,
  activeAgentId
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "p-0",
      description: "Agent rows captured from the local desktop monitor.",
      title: "Agents"
    },
    agents.length === 0 ? /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-10",
        description: "No agent records were captured for this session.",
        icon: import_lucide_react3.WrenchIcon,
        title: "No agents"
      }
    ) : /* @__PURE__ */ React.createElement("div", { className: "grid gap-3 px-6 pb-6 lg:grid-cols-2" }, agents.map((agent) => /* @__PURE__ */ React.createElement(
      AgentCard,
      {
        active: agent.id === activeAgentId,
        agent,
        key: agent.id
      }
    )))
  );
}
function SessionTimelineSection({
  facets,
  groups,
  activeFilters
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-0",
      title: "Event timeline",
      description: "Normalized event stream with shared filtering and grouped rows."
    },
    groups.length === 0 ? /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-10",
        description: "No events were captured for this session.",
        icon: import_lucide_react3.HistoryIcon,
        title: "No events"
      }
    ) : /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-2 border-border/70 border-b px-6 pb-4 text-xs" }, /* @__PURE__ */ React.createElement(Chip, { variant: "muted" }, facets.statuses.length, " statuses"), /* @__PURE__ */ React.createElement(Chip, { variant: "muted" }, facets.eventTypes.length, " event types"), /* @__PURE__ */ React.createElement(Chip, { variant: "muted" }, facets.toolNames.length, " tools"), /* @__PURE__ */ React.createElement(Chip, { variant: "muted" }, facets.agents.length, " agents"), activeFilters?.query ? /* @__PURE__ */ React.createElement(Chip, { interactive: true, variant: "outline" }, "Search: ", activeFilters.query) : null, activeFilters?.statuses.map((status) => /* @__PURE__ */ React.createElement(Chip, { key: `status-${status}`, variant: "outline" }, status)), activeFilters?.eventTypes.map((eventType) => /* @__PURE__ */ React.createElement(Chip, { key: `event-${eventType}`, variant: "outline" }, eventType)), activeFilters?.toolNames.map((toolName) => /* @__PURE__ */ React.createElement(Chip, { key: `tool-${toolName}`, variant: "outline" }, toolName))), /* @__PURE__ */ React.createElement("div", { className: "space-y-3 px-6 pb-6" }, groups.map((group) => /* @__PURE__ */ React.createElement(EventGroupRow, { group, key: group.id }))))
  );
}
function SessionOverviewSection({
  stats
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-0",
      title: "Session overview",
      description: "Shared session analytics built from events, tools, subagents, and token flow."
    },
    /* @__PURE__ */ React.createElement("div", { className: "space-y-6" }, /* @__PURE__ */ React.createElement("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-3" }, /* @__PURE__ */ React.createElement(
      MetricCard,
      {
        detail: stats.eventRateHint,
        icon: import_lucide_react3.HistoryIcon,
        label: "Events",
        value: stats.totalEvents.toLocaleString()
      }
    ), /* @__PURE__ */ React.createElement(
      MetricCard,
      {
        icon: import_lucide_react3.WrenchIcon,
        label: "Tool calls",
        value: stats.toolCalls.toLocaleString()
      }
    ), /* @__PURE__ */ React.createElement(
      MetricCard,
      {
        icon: import_lucide_react3.BotIcon,
        label: "Subagents",
        value: stats.subagents.toLocaleString()
      }
    ), /* @__PURE__ */ React.createElement(
      MetricCard,
      {
        icon: import_lucide_react3.Clock3Icon,
        label: "Compactions",
        value: stats.compactions.toLocaleString()
      }
    ), /* @__PURE__ */ React.createElement(
      MetricCard,
      {
        icon: import_lucide_react3.AlertCircleIcon,
        label: "Errors",
        value: stats.errors.toLocaleString()
      }
    ), /* @__PURE__ */ React.createElement(
      MetricCard,
      {
        icon: import_lucide_react3.FolderGit2Icon,
        label: "Duration",
        value: stats.durationLabel
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "grid gap-4 lg:grid-cols-3" }, /* @__PURE__ */ React.createElement("div", { className: "rounded-xl border border-border/80 bg-muted/10 p-4" }, /* @__PURE__ */ React.createElement("h4", { className: "font-medium text-sm" }, "Top tools"), /* @__PURE__ */ React.createElement("div", { className: "mt-3 space-y-2" }, stats.topTools.length ? stats.topTools.map((tool) => /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2",
        key: tool.toolName
      },
      /* @__PURE__ */ React.createElement("span", { className: "font-mono text-sm" }, tool.toolName),
      /* @__PURE__ */ React.createElement(Chip, { variant: "muted" }, tool.count)
    )) : /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, "No tool activity."))), /* @__PURE__ */ React.createElement("div", { className: "rounded-xl border border-border/80 bg-muted/10 p-4" }, /* @__PURE__ */ React.createElement("h4", { className: "font-medium text-sm" }, "Subagent types"), /* @__PURE__ */ React.createElement("div", { className: "mt-3 flex flex-wrap gap-2" }, stats.subagentTypes.length ? stats.subagentTypes.map((entry) => /* @__PURE__ */ React.createElement(
      Chip,
      {
        key: entry.label,
        variant: entry.isCompaction ? "warning" : "outline"
      },
      entry.label,
      " ",
      entry.count
    )) : /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, "No subagent activity."))), /* @__PURE__ */ React.createElement("div", { className: "rounded-xl border border-border/80 bg-muted/10 p-4" }, /* @__PURE__ */ React.createElement("h4", { className: "font-medium text-sm" }, "Token mix"), /* @__PURE__ */ React.createElement("div", { className: "mt-3 space-y-2 text-sm" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("span", null, "Input"), /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, stats.tokens.inputTokens.toLocaleString())), /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("span", null, "Output"), /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, stats.tokens.outputTokens.toLocaleString())), /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("span", null, "Cache read"), /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, stats.tokens.cacheReadTokens.toLocaleString())), /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("span", null, "Cache write"), /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, stats.tokens.cacheWriteTokens.toLocaleString()))))), stats.activeAgent ? /* @__PURE__ */ React.createElement("div", { className: "rounded-xl border border-border/80 bg-muted/10 p-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement("h4", { className: "font-medium text-sm" }, "Active agent"), /* @__PURE__ */ React.createElement(Chip, { variant: "outline" }, stats.activeAgent.name), stats.activeAgent.currentTool ? /* @__PURE__ */ React.createElement(Chip, { variant: "muted" }, stats.activeAgent.currentTool) : null), stats.activeAgent.task ? /* @__PURE__ */ React.createElement("p", { className: "mt-3 text-muted-foreground text-sm" }, stats.activeAgent.task) : null) : null)
  );
}
function JsonPanel({
  title,
  description,
  value,
  emptyMessage = "No structured data is available."
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-0",
      description,
      title
    },
    value ? /* @__PURE__ */ React.createElement("pre", { className: "overflow-auto rounded-md bg-muted p-3 text-xs" }, value) : /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-10",
        description: emptyMessage,
        icon: import_lucide_react3.TerminalSquareIcon,
        title: `No ${title.toLowerCase()}`
      }
    )
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  JsonPanel,
  SessionAgentsSection,
  SessionAttributionPanel,
  SessionErrorDetailsPanel,
  SessionMetadataPanel,
  SessionModelUsageTable,
  SessionOverviewSection,
  SessionSummaryMetrics,
  SessionTimelineSection,
  SessionToolInvocationsPanel
});
//# sourceMappingURL=session-detail-panels.js.map