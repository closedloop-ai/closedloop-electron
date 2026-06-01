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

// components/ui/layout/section.tsx
function Section({
  title,
  description,
  actions,
  children,
  className,
  contentClassName
}) {
  return /* @__PURE__ */ React.createElement(Card, { className: cn("border-border/80 bg-card/95 shadow-sm", className) }, /* @__PURE__ */ React.createElement(CardHeader, { className: "flex flex-row items-start justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, /* @__PURE__ */ React.createElement(CardTitle, null, title), description ? /* @__PURE__ */ React.createElement(CardDescription, null, description) : null), actions), /* @__PURE__ */ React.createElement(CardContent, { className: contentClassName }, children));
}

export {
  Section
};
//# sourceMappingURL=chunk-ZF7NKEIL.mjs.map