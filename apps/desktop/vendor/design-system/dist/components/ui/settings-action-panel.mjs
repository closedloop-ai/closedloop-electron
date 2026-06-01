import React from "react";
"use client";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/settings-action-panel.tsx
function SettingsActionPanel({
  title,
  description,
  icon,
  action,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3",
        className
      )
    },
    /* @__PURE__ */ React.createElement("div", { className: "min-w-0" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, icon ? /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground" }, icon) : null, /* @__PURE__ */ React.createElement("p", { className: "font-medium text-sm" }, title)), /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-xs" }, description)),
    action ? /* @__PURE__ */ React.createElement("div", { className: "shrink-0" }, action) : null
  );
}
export {
  SettingsActionPanel
};
//# sourceMappingURL=settings-action-panel.mjs.map