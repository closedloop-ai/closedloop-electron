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

// components/ui/composites/cli-tools-panel.tsx
var cli_tools_panel_exports = {};
__export(cli_tools_panel_exports, {
  CliToolsPanel: () => CliToolsPanel
});
module.exports = __toCommonJS(cli_tools_panel_exports);

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

// components/ui/input.tsx
var React4 = __toESM(require("react"));
function Input({ className, type, ...props }) {
  return /* @__PURE__ */ React4.createElement(
    "input",
    {
      type,
      "data-slot": "input",
      className: cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground bg-input dark:bg-input border-input-border h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      ),
      ...props
    }
  );
}

// components/ui/composites/cli-tools-panel.tsx
var import_lucide_react = require("lucide-react");

// components/ui/badge.tsx
var React5 = __toESM(require("react"));
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
  return /* @__PURE__ */ React5.createElement(
    Comp,
    {
      "data-slot": "badge",
      className: cn(badgeVariants({ variant }), className),
      ...props
    }
  );
}

// components/ui/primitives/status-badge.tsx
var toneClasses = {
  default: "border-input-border bg-input text-foreground",
  success: "border-success/25 bg-success/12 text-success",
  warning: "border-warning/30 bg-warning/14 text-warning-foreground",
  danger: "border-destructive/25 bg-destructive/12 text-destructive",
  info: "border-info/25 bg-info/12 text-info",
  accent: "border-primary/20 bg-primary/10 text-primary",
  muted: "border-border bg-muted/70 text-muted-foreground"
};
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

// components/ui/composites/cli-tools-panel.tsx
var cliToolTone = {
  checking: { label: "Checking", tone: "info" },
  detected: { label: "Detected", tone: "success" },
  custom: { label: "Custom path", tone: "accent" },
  invalid: { label: "Invalid path", tone: "danger" },
  missing: { label: "Not found", tone: "warning" }
};
var cliToolIcon = {
  detected: import_lucide_react.CheckCircle2,
  custom: import_lucide_react.Wrench,
  invalid: import_lucide_react.FileWarning,
  missing: import_lucide_react.Search,
  checking: import_lucide_react.Search
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CliToolsPanel
});
//# sourceMappingURL=cli-tools-panel.js.map