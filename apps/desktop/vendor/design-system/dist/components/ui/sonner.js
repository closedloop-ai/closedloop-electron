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

// components/ui/sonner.tsx
var sonner_exports = {};
__export(sonner_exports, {
  Toaster: () => Toaster,
  toast: () => import_sonner.toast
});
module.exports = __toCommonJS(sonner_exports);
var import_lucide_react = require("lucide-react");
var import_next_themes = require("next-themes");
var import_sonner = require("sonner");
var Toaster = ({ ...props }) => {
  const { theme = "system" } = (0, import_next_themes.useTheme)();
  return /* @__PURE__ */ React.createElement(
    import_sonner.Toaster,
    {
      theme,
      className: "toaster group",
      icons: {
        success: /* @__PURE__ */ React.createElement(import_lucide_react.CircleCheckIcon, { className: "size-4" }),
        info: /* @__PURE__ */ React.createElement(import_lucide_react.InfoIcon, { className: "size-4" }),
        warning: /* @__PURE__ */ React.createElement(import_lucide_react.TriangleAlertIcon, { className: "size-4" }),
        error: /* @__PURE__ */ React.createElement(import_lucide_react.OctagonXIcon, { className: "size-4" }),
        loading: /* @__PURE__ */ React.createElement(import_lucide_react.Loader2Icon, { className: "size-4 animate-spin" })
      },
      style: {
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "var(--radius)"
      },
      ...props
    }
  );
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Toaster,
  toast
});
//# sourceMappingURL=sonner.js.map