import React from "react";
"use client";
import {
  Input
} from "../../chunk-J7MGMQSF.mjs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../chunk-CI7GGEKC.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/judge-result-card.tsx
import { ChevronDown, Loader2Icon } from "lucide-react";
function getScoreConfig(isPassing) {
  if (isPassing) {
    return {
      border: "border-success",
      background: "bg-success/10",
      text: "text-success-foreground",
      label: "Passing"
    };
  }
  return {
    border: "border-destructive",
    background: "bg-destructive/10",
    text: "text-destructive",
    label: "Failing"
  };
}
function JudgeResultCard({
  title,
  score,
  threshold,
  scoreLabel,
  justification,
  defaultOpen = false,
  editable = false,
  inputValue,
  validationError,
  isSaving = false,
  onInputChange,
  onInputBlur
}) {
  const isPassing = score >= threshold;
  const config = getScoreConfig(isPassing);
  return /* @__PURE__ */ React.createElement(
    Collapsible,
    {
      className: `rounded-lg border ${config.border} ${config.background} p-3`,
      defaultOpen
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-start justify-between gap-3" }, /* @__PURE__ */ React.createElement(CollapsibleTrigger, { className: "group flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80" }, /* @__PURE__ */ React.createElement(ChevronDown, { className: "h-4 w-4 transition-transform group-data-[state=closed]:-rotate-90" }), /* @__PURE__ */ React.createElement("div", { className: "flex min-w-0 flex-col gap-0.5" }, /* @__PURE__ */ React.createElement("span", { className: "truncate font-medium text-sm" }, title), /* @__PURE__ */ React.createElement("span", { className: `font-semibold text-xs ${config.text}` }, "Score: ", scoreLabel, " (", config.label, ")"))), editable ? /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 items-center gap-2" }, /* @__PURE__ */ React.createElement(
      Input,
      {
        className: "h-8 w-20 text-right text-sm",
        max: 1,
        min: 0,
        onBlur: onInputBlur,
        onChange: (event) => onInputChange?.(event.target.value),
        onClick: (event) => {
          event.stopPropagation();
        },
        step: 0.01,
        type: "number",
        value: inputValue
      }
    ), isSaving ? /* @__PURE__ */ React.createElement(Loader2Icon, { className: "h-4 w-4 animate-spin text-muted-foreground" }) : null) : null),
    validationError ? /* @__PURE__ */ React.createElement("p", { className: "mt-2 text-destructive text-xs" }, validationError) : null,
    /* @__PURE__ */ React.createElement(CollapsibleContent, null, justification ? /* @__PURE__ */ React.createElement("div", { className: "mt-2 ml-7 space-y-1 text-muted-foreground text-sm" }, /* @__PURE__ */ React.createElement("p", { className: "font-medium text-xs uppercase tracking-wide" }, "Reasoning"), /* @__PURE__ */ React.createElement("p", { className: "whitespace-pre-wrap" }, justification)) : /* @__PURE__ */ React.createElement("div", { className: "mt-2 ml-7 text-muted-foreground text-sm italic" }, "No reasoning provided"))
  );
}
export {
  JudgeResultCard
};
//# sourceMappingURL=judge-result-card.mjs.map