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

// components/ui/primitives/event-group-row.tsx
var event_group_row_exports = {};
__export(event_group_row_exports, {
  EventGroupRow: () => EventGroupRow
});
module.exports = __toCommonJS(event_group_row_exports);

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

// components/ui/primitives/event-group-row.tsx
var import_lucide_react = require("lucide-react");
var import_react = require("react");

// components/ui/utils.ts
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

// components/ui/badge.tsx
var React3 = __toESM(require("react"));
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
  return /* @__PURE__ */ React3.createElement(
    Comp,
    {
      "data-slot": "badge",
      className: cn(badgeVariants({ variant }), className),
      ...props
    }
  );
}

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

// components/ui/primitives/event-group-row.tsx
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
        import_lucide_react.ChevronRight,
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EventGroupRow
});
//# sourceMappingURL=event-group-row.js.map