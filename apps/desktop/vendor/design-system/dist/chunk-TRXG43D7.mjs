import React from "react";
import {
  Badge
} from "./chunk-3I7NW6GS.mjs";
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

export {
  WorkflowStatTile
};
//# sourceMappingURL=chunk-TRXG43D7.mjs.map