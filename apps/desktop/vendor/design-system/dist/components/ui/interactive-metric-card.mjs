import React from "react";
"use client";
import {
  MetricCard
} from "../../chunk-WEVGGIH7.mjs";
import "../../chunk-ZKMGHYX7.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

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
export {
  InteractiveMetricCard
};
//# sourceMappingURL=interactive-metric-card.mjs.map