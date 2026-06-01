var React = require("react");
"use strict";
"use client";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// components/ui/settings-action-panel.tsx
var settings_action_panel_exports = {};
__export(settings_action_panel_exports, {
  SettingsActionPanel: () => SettingsActionPanel
});
module.exports = __toCommonJS(settings_action_panel_exports);

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SettingsActionPanel
});
//# sourceMappingURL=settings-action-panel.js.map