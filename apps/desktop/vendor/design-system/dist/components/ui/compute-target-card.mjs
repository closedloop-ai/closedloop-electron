import React from "react";
"use client";
import {
  Switch
} from "../../chunk-W3BLYIXH.mjs";
import {
  Badge
} from "../../chunk-3I7NW6GS.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/compute-target-card.tsx
function ComputeTargetCard({
  name,
  isOnline,
  securityBadge,
  subtitle,
  actions,
  shareChecked,
  shareDisabled = false,
  onShareCheckedChange,
  shareTitle = "Share with team",
  shareDescription = "Allow anyone in your org to run jobs on this machine",
  systemCheck,
  className
}) {
  return /* @__PURE__ */ React.createElement("div", { className: cn("rounded-lg border p-3", className) }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "min-w-0 flex-1" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("p", { className: "truncate font-medium" }, name), /* @__PURE__ */ React.createElement(Badge, { className: "capitalize", variant: isOnline ? "default" : "secondary" }, isOnline ? "online" : "offline"), securityBadge), /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-xs" }, subtitle)), actions ? /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, actions) : null), /* @__PURE__ */ React.createElement("div", { className: "mt-2 flex items-center justify-between border-t pt-2" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "text-sm" }, shareTitle), /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-xs" }, shareDescription)), /* @__PURE__ */ React.createElement(
    Switch,
    {
      checked: shareChecked,
      disabled: shareDisabled,
      onCheckedChange: onShareCheckedChange
    }
  )), systemCheck);
}
export {
  ComputeTargetCard
};
//# sourceMappingURL=compute-target-card.mjs.map