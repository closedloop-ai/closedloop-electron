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

// components/ui/compute-target-system-check.tsx
var compute_target_system_check_exports = {};
__export(compute_target_system_check_exports, {
  ComputeTargetSystemCheck: () => ComputeTargetSystemCheck
});
module.exports = __toCommonJS(compute_target_system_check_exports);

// components/ui/badge.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/badge.tsx
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
  return /* @__PURE__ */ React2.createElement(
    Comp,
    {
      "data-slot": "badge",
      className: cn(badgeVariants({ variant }), className),
      ...props
    }
  );
}

// components/ui/button.tsx
var React3 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_class_variance_authority2 = require("class-variance-authority");
var buttonVariants = (0, import_class_variance_authority2.cva)(
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
  const Comp = asChild ? import_radix_ui2.Slot.Slot : "button";
  return /* @__PURE__ */ React3.createElement(
    Comp,
    {
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size, className })),
      ...props
    }
  );
}

// components/ui/collapsible.tsx
var import_radix_ui3 = require("radix-ui");
function Collapsible({
  ...props
}) {
  return /* @__PURE__ */ React.createElement(import_radix_ui3.Collapsible.Root, { "data-slot": "collapsible", ...props });
}
function CollapsibleTrigger({
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    import_radix_ui3.Collapsible.CollapsibleTrigger,
    {
      "data-slot": "collapsible-trigger",
      ...props
    }
  );
}
function CollapsibleContent({
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    import_radix_ui3.Collapsible.CollapsibleContent,
    {
      "data-slot": "collapsible-content",
      ...props
    }
  );
}

// components/ui/compute-target-system-check.tsx
var import_lucide_react = require("lucide-react");
var import_react = require("react");
var BADGE_CLASS_NAMES = {
  idle: "border-primary/20 bg-primary/5 text-primary",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  loading: "border-primary/30 bg-primary/10 text-primary",
  disabled: "border-border bg-background/70 text-muted-foreground"
};
function ComputeTargetSystemCheck({
  summary,
  description,
  state,
  actionLabel,
  onAction,
  actionDisabled = false,
  content,
  fallback,
  defaultOpen = false,
  title = "System Check",
  checkedAtLabel,
  failureCount,
  hasResult,
  isEligible,
  isLoading,
  targetName
}) {
  const [open, setOpen] = (0, import_react.useState)(defaultOpen);
  const resolvedHasResult = hasResult ?? content !== void 0;
  const resolvedIsEligible = isEligible ?? state !== "disabled";
  const resolvedIsLoading = isLoading ?? state === "loading";
  const resolvedState = state ?? getSystemCheckState({
    failureCount,
    hasResult: resolvedHasResult,
    isEligible: resolvedIsEligible,
    isLoading: resolvedIsLoading
  });
  const resolvedSummary = summary ?? getSystemCheckSummary({
    failureCount,
    hasResult: resolvedHasResult,
    isEligible: resolvedIsEligible,
    isLoading: resolvedIsLoading
  });
  const resolvedDescription = description ?? getSystemCheckDescription({
    checkedAtLabel,
    hasResult: resolvedHasResult,
    isEligible: resolvedIsEligible,
    isLoading: resolvedIsLoading,
    targetName
  });
  const resolvedActionLabel = actionLabel ?? (resolvedHasResult ? "Re-check" : "Run check");
  const resolvedFallback = fallback ?? (resolvedIsEligible ? /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, "Run a system check to inspect this compute target.") : /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, "System checks are available when this compute target is online."));
  return /* @__PURE__ */ React.createElement(Collapsible, { onOpenChange: setOpen, open }, /* @__PURE__ */ React.createElement("div", { className: "-mx-3 mt-3 border-t bg-muted/15 px-4 py-4" }, /* @__PURE__ */ React.createElement("div", { className: "grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center" }, /* @__PURE__ */ React.createElement(CollapsibleTrigger, { className: "group flex min-w-0 items-start gap-3 rounded-sm text-left" }, /* @__PURE__ */ React.createElement("div", { className: "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/55 text-muted-foreground transition-colors group-hover:bg-muted group-hover:text-foreground" }, /* @__PURE__ */ React.createElement(import_lucide_react.ChevronDown, { className: "size-4 transition-transform group-data-[state=closed]:-rotate-90" })), /* @__PURE__ */ React.createElement("div", { className: "min-w-0 space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement(SystemCheckStatusIcon, { state: resolvedState }), /* @__PURE__ */ React.createElement("p", { className: "font-medium text-sm" }, title), /* @__PURE__ */ React.createElement(
    Badge,
    {
      className: `h-6 rounded-md px-2 font-medium text-xs tabular-nums ${BADGE_CLASS_NAMES[resolvedState]}`,
      variant: "outline"
    },
    resolvedSummary
  )), /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-sm" }, resolvedDescription))), /* @__PURE__ */ React.createElement(
    Button,
    {
      className: "w-full shrink-0 gap-1.5 md:w-auto",
      disabled: actionDisabled,
      onClick: (event) => {
        event.stopPropagation();
        void onAction?.();
      },
      size: "sm",
      variant: "outline"
    },
    /* @__PURE__ */ React.createElement(
      import_lucide_react.RefreshCw,
      {
        className: `size-3.5 ${resolvedIsLoading ? "animate-spin" : ""}`
      }
    ),
    resolvedActionLabel
  )), /* @__PURE__ */ React.createElement(CollapsibleContent, { className: "mt-4 border-t pt-4" }, content ?? resolvedFallback)));
}
function getSystemCheckState({
  failureCount,
  hasResult,
  isEligible,
  isLoading
}) {
  if (isLoading) {
    return "loading";
  }
  if (!isEligible) {
    return "disabled";
  }
  if (!hasResult) {
    return "idle";
  }
  if (failureCount === 0) {
    return "success";
  }
  return "warning";
}
function getSystemCheckSummary({
  failureCount,
  hasResult,
  isEligible,
  isLoading
}) {
  if (!hasResult) {
    if (isLoading) {
      return "Running system check...";
    }
    return isEligible ? "Awaiting first system check" : "System check unavailable";
  }
  if (failureCount === 0) {
    return "All checks passed";
  }
  if (typeof failureCount === "number" && failureCount > 0) {
    return `${failureCount} failure${failureCount === 1 ? "" : "s"}`;
  }
  return "Check completed";
}
function getSystemCheckDescription({
  checkedAtLabel,
  hasResult,
  isEligible,
  isLoading,
  targetName
}) {
  if (hasResult) {
    return checkedAtLabel ? `Last checked ${checkedAtLabel}` : "System check completed.";
  }
  if (isLoading) {
    return targetName ? `Checking ${targetName}.` : "Running system check.";
  }
  if (isEligible) {
    return targetName ? `Run a check for ${targetName}.` : "Run a system check.";
  }
  return "System checks require this compute target to be online.";
}
function SystemCheckStatusIcon({
  state
}) {
  switch (state) {
    case "loading":
      return /* @__PURE__ */ React.createElement(import_lucide_react.Loader2, { className: "size-4 animate-spin text-muted-foreground" });
    case "success":
      return /* @__PURE__ */ React.createElement(import_lucide_react.CheckCircle2, { className: "size-4 text-emerald-500" });
    case "warning":
      return /* @__PURE__ */ React.createElement(import_lucide_react.AlertCircle, { className: "size-4 text-amber-500" });
    case "disabled":
    case "idle":
    default:
      return /* @__PURE__ */ React.createElement(import_lucide_react.Info, { className: "size-4 text-muted-foreground" });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ComputeTargetSystemCheck
});
//# sourceMappingURL=compute-target-system-check.js.map