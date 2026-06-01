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

// components/ui/judge-result-card.tsx
var judge_result_card_exports = {};
__export(judge_result_card_exports, {
  JudgeResultCard: () => JudgeResultCard
});
module.exports = __toCommonJS(judge_result_card_exports);

// components/ui/collapsible.tsx
var import_radix_ui = require("radix-ui");
function Collapsible({
  ...props
}) {
  return /* @__PURE__ */ React.createElement(import_radix_ui.Collapsible.Root, { "data-slot": "collapsible", ...props });
}
function CollapsibleTrigger({
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    import_radix_ui.Collapsible.CollapsibleTrigger,
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
    import_radix_ui.Collapsible.CollapsibleContent,
    {
      "data-slot": "collapsible-content",
      ...props
    }
  );
}

// components/ui/input.tsx
var React2 = __toESM(require("react"));

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/input.tsx
function Input({ className, type, ...props }) {
  return /* @__PURE__ */ React2.createElement(
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

// components/ui/judge-result-card.tsx
var import_lucide_react = require("lucide-react");
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
    /* @__PURE__ */ React.createElement("div", { className: "flex items-start justify-between gap-3" }, /* @__PURE__ */ React.createElement(CollapsibleTrigger, { className: "group flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80" }, /* @__PURE__ */ React.createElement(import_lucide_react.ChevronDown, { className: "h-4 w-4 transition-transform group-data-[state=closed]:-rotate-90" }), /* @__PURE__ */ React.createElement("div", { className: "flex min-w-0 flex-col gap-0.5" }, /* @__PURE__ */ React.createElement("span", { className: "truncate font-medium text-sm" }, title), /* @__PURE__ */ React.createElement("span", { className: `font-semibold text-xs ${config.text}` }, "Score: ", scoreLabel, " (", config.label, ")"))), editable ? /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 items-center gap-2" }, /* @__PURE__ */ React.createElement(
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
    ), isSaving ? /* @__PURE__ */ React.createElement(import_lucide_react.Loader2Icon, { className: "h-4 w-4 animate-spin text-muted-foreground" }) : null) : null),
    validationError ? /* @__PURE__ */ React.createElement("p", { className: "mt-2 text-destructive text-xs" }, validationError) : null,
    /* @__PURE__ */ React.createElement(CollapsibleContent, null, justification ? /* @__PURE__ */ React.createElement("div", { className: "mt-2 ml-7 space-y-1 text-muted-foreground text-sm" }, /* @__PURE__ */ React.createElement("p", { className: "font-medium text-xs uppercase tracking-wide" }, "Reasoning"), /* @__PURE__ */ React.createElement("p", { className: "whitespace-pre-wrap" }, justification)) : /* @__PURE__ */ React.createElement("div", { className: "mt-2 ml-7 text-muted-foreground text-sm italic" }, "No reasoning provided"))
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  JudgeResultCard
});
//# sourceMappingURL=judge-result-card.js.map