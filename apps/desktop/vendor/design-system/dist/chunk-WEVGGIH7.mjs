import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "./chunk-ZKMGHYX7.mjs";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

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

export {
  MetricCard
};
//# sourceMappingURL=chunk-WEVGGIH7.mjs.map