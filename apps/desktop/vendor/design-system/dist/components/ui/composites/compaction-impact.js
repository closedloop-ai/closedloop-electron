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

// components/ui/composites/compaction-impact.tsx
var compaction_impact_exports = {};
__export(compaction_impact_exports, {
  CompactionImpact: () => CompactionImpact
});
module.exports = __toCommonJS(compaction_impact_exports);
var import_lucide_react = require("lucide-react");

// components/ui/card.tsx
var React2 = __toESM(require("react"));

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/card.tsx
function Card({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
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
  return /* @__PURE__ */ React2.createElement(
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
  return /* @__PURE__ */ React2.createElement(
    "div",
    {
      "data-slot": "card-title",
      className: cn("leading-none font-semibold", className),
      ...props
    }
  );
}
function CardDescription({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "div",
    {
      "data-slot": "card-description",
      className: cn("text-muted-foreground text-sm", className),
      ...props
    }
  );
}
function CardContent({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
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
var React3 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");
var badgeVariants = (0, import_class_variance_authority.cva)(
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
  const Comp = asChild ? import_radix_ui.Slot.Slot : "span";
  return /* @__PURE__ */ React3.createElement(
    Comp,
    {
      "data-slot": "badge",
      className: cn(badgeVariants({ variant }), className),
      ...props
    }
  );
}

// components/ui/progress.tsx
var React4 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
function Progress({
  className,
  value,
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(
    import_radix_ui2.Progress.Root,
    {
      "data-slot": "progress",
      className: cn(
        "bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React4.createElement(
      import_radix_ui2.Progress.Indicator,
      {
        "data-slot": "progress-indicator",
        className: "bg-primary h-full w-full flex-1 transition-all",
        style: { transform: `translateX(-${100 - (value || 0)}%)` }
      }
    )
  );
}

// components/ui/primitives/ranked-bar.tsx
function RankedBar({
  label,
  value,
  percent,
  description,
  badge,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "space-y-2 rounded-xl border border-border/80 bg-muted/25 p-3",
        className
      )
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "min-w-0 space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "font-medium text-sm" }, label), badge), description ? /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-xs" }, description) : null), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 text-right" }, /* @__PURE__ */ React.createElement("span", { className: "font-semibold text-sm" }, value), /* @__PURE__ */ React.createElement(Badge, { variant: "muted" }, percent.toFixed(percent >= 10 ? 0 : 1), "%"))),
    /* @__PURE__ */ React.createElement(Progress, { value: percent })
  );
}

// components/ui/primitives/workflow-stat-tile.tsx
function WorkflowStatTile({
  label,
  value,
  description,
  eyebrow,
  icon: Icon,
  meta,
  className
}) {
  return /* @__PURE__ */ React.createElement(Card, { className: cn("border-border/80 bg-card/95 shadow-sm", className) }, /* @__PURE__ */ React.createElement(CardHeader, { className: "flex flex-row items-start justify-between gap-4 space-y-0 pb-3" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, eyebrow ? /* @__PURE__ */ React.createElement(
    Badge,
    {
      className: "rounded-md px-1.5 py-0.5 text-[10px]",
      variant: "muted"
    },
    eyebrow
  ) : null, /* @__PURE__ */ React.createElement(CardDescription, { className: "font-semibold text-[11px] uppercase tracking-[0.12em]" }, label), /* @__PURE__ */ React.createElement(CardTitle, { className: "font-semibold text-2xl tracking-tight" }, value)), Icon ? /* @__PURE__ */ React.createElement("span", { className: "flex size-9 items-center justify-center rounded-xl border border-primary/10 bg-primary/10 text-primary" }, /* @__PURE__ */ React.createElement(Icon, { className: "size-4" })) : null), description || meta ? /* @__PURE__ */ React.createElement(CardContent, { className: "flex items-end justify-between gap-3 pt-0" }, description ? /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, description) : /* @__PURE__ */ React.createElement("span", null), meta) : null);
}

// components/ui/utils.ts
function formatCompactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
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

// components/ui/composites/compaction-impact.tsx
function CompactionImpact({
  data
}) {
  const maxCompactions = Math.max(
    ...data.perSession.map((item) => item.compactions),
    1
  );
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-4",
      description: "Context-compaction recovery surfaced as reusable stat tiles and ranked bars.",
      title: "Compaction impact"
    },
    /* @__PURE__ */ React.createElement("div", { className: "grid gap-4 md:grid-cols-2" }, /* @__PURE__ */ React.createElement(
      WorkflowStatTile,
      {
        description: "Observed across decomposed workflow traces",
        icon: import_lucide_react.RefreshCcw,
        label: "Total compactions",
        value: formatCompactNumber(data.totalCompactions)
      }
    ), /* @__PURE__ */ React.createElement(
      WorkflowStatTile,
      {
        description: `${data.sessionsWithCompactions} of ${data.totalSessions} sessions compacted`,
        icon: import_lucide_react.RefreshCcw,
        label: "Recovered tokens",
        value: formatCompactNumber(data.tokensRecovered)
      }
    )),
    /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, data.perSession.map((item) => /* @__PURE__ */ React.createElement(
      RankedBar,
      {
        key: item.sessionId,
        label: item.sessionId,
        percent: item.compactions / maxCompactions * 100,
        value: item.compactions
      }
    )))
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CompactionImpact
});
//# sourceMappingURL=compaction-impact.js.map