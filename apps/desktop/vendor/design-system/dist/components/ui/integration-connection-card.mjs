import React from "react";
"use client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../chunk-ZKMGHYX7.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/integration-connection-card.tsx
import { Loader2Icon } from "lucide-react";
function IntegrationConnectionCard({
  title,
  description,
  titleIcon,
  isLoading = false,
  className,
  banner,
  statusIcon,
  statusTitle,
  statusDescription,
  actions,
  children
}) {
  return /* @__PURE__ */ React.createElement(Card, { className }, /* @__PURE__ */ React.createElement(CardHeader, null, /* @__PURE__ */ React.createElement(CardTitle, { className: "flex items-center gap-2" }, titleIcon, title), /* @__PURE__ */ React.createElement(CardDescription, null, description)), /* @__PURE__ */ React.createElement(CardContent, null, isLoading ? /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-center py-4" }, /* @__PURE__ */ React.createElement(Loader2Icon, { className: "h-6 w-6 animate-spin text-muted-foreground" })) : /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, banner, statusTitle || actions ? /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3" }, statusIcon, /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, statusTitle ? /* @__PURE__ */ React.createElement("p", { className: "font-medium" }, statusTitle) : null, statusDescription ? /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "text-muted-foreground text-sm",
        !statusTitle && "text-foreground"
      )
    },
    statusDescription
  ) : null)), actions ? /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 flex-wrap items-center gap-2 sm:justify-end" }, actions) : null) : null, children)));
}
export {
  IntegrationConnectionCard
};
//# sourceMappingURL=integration-connection-card.mjs.map