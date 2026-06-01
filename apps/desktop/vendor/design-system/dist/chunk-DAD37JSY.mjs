import React from "react";
import {
  Progress
} from "./chunk-OBV5RENT.mjs";
import {
  Badge
} from "./chunk-3I7NW6GS.mjs";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

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

export {
  RankedBar
};
//# sourceMappingURL=chunk-DAD37JSY.mjs.map