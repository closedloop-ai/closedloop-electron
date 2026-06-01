import React from "react";
"use client";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../chunk-CI7GGEKC.mjs";
import {
  Badge
} from "../../chunk-3I7NW6GS.mjs";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/compute-target-system-check.tsx
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Info,
  Loader2,
  RefreshCw
} from "lucide-react";
import { useState } from "react";
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
  const [open, setOpen] = useState(defaultOpen);
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
  return /* @__PURE__ */ React.createElement(Collapsible, { onOpenChange: setOpen, open }, /* @__PURE__ */ React.createElement("div", { className: "-mx-3 mt-3 border-t bg-muted/15 px-4 py-4" }, /* @__PURE__ */ React.createElement("div", { className: "grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center" }, /* @__PURE__ */ React.createElement(CollapsibleTrigger, { className: "group flex min-w-0 items-start gap-3 rounded-sm text-left" }, /* @__PURE__ */ React.createElement("div", { className: "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/55 text-muted-foreground transition-colors group-hover:bg-muted group-hover:text-foreground" }, /* @__PURE__ */ React.createElement(ChevronDown, { className: "size-4 transition-transform group-data-[state=closed]:-rotate-90" })), /* @__PURE__ */ React.createElement("div", { className: "min-w-0 space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement(SystemCheckStatusIcon, { state: resolvedState }), /* @__PURE__ */ React.createElement("p", { className: "font-medium text-sm" }, title), /* @__PURE__ */ React.createElement(
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
      RefreshCw,
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
      return /* @__PURE__ */ React.createElement(Loader2, { className: "size-4 animate-spin text-muted-foreground" });
    case "success":
      return /* @__PURE__ */ React.createElement(CheckCircle2, { className: "size-4 text-emerald-500" });
    case "warning":
      return /* @__PURE__ */ React.createElement(AlertCircle, { className: "size-4 text-amber-500" });
    case "disabled":
    case "idle":
    default:
      return /* @__PURE__ */ React.createElement(Info, { className: "size-4 text-muted-foreground" });
  }
}
export {
  ComputeTargetSystemCheck
};
//# sourceMappingURL=compute-target-system-check.mjs.map