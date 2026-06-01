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

// components/ui/interactive-metric-card.tsx
var interactive_metric_card_exports = {};
__export(interactive_metric_card_exports, {
  InteractiveMetricCard: () => InteractiveMetricCard
});
module.exports = __toCommonJS(interactive_metric_card_exports);

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/card.tsx
var React2 = __toESM(require("react"));
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

// components/ui/interactive-metric-card.tsx
function InteractiveMetricCard({
  active = false,
  className,
  onClick,
  ...props
}) {
  const card = /* @__PURE__ */ React.createElement(
    MetricCard,
    {
      className: cn(
        active ? "border-emerald-500/70 bg-emerald-900/30 ring-1 ring-emerald-500/30 [&_[data-slot=card-description]]:text-emerald-200/80 [&_[data-slot=card-title]]:text-emerald-400" : "border-slate-700/50 bg-slate-800/60 hover:border-slate-600 [&_[data-slot=card-description]]:text-slate-400 [&_[data-slot=card-title]]:text-white",
        className
      ),
      ...props
    }
  );
  if (!onClick) {
    return card;
  }
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      "aria-pressed": active,
      className: "w-full rounded-xl text-left",
      onClick,
      type: "button"
    },
    card
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  InteractiveMetricCard
});
//# sourceMappingURL=interactive-metric-card.js.map