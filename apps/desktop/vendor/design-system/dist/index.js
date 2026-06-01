"use strict";
var React = require("react");
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// index.tsx
var index_exports = {};
__export(index_exports, {
  DesignSystemProvider: () => DesignSystemProvider
});
module.exports = __toCommonJS(index_exports);

// components/ui/sonner.tsx
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

// components/ui/tooltip.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner2 = require("sonner");
var import_tailwind_merge = require("tailwind-merge");

// components/ui/tooltip.tsx
function TooltipProvider({
  delayDuration = 700,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.Tooltip.Provider,
    {
      "data-slot": "tooltip-provider",
      delayDuration,
      ...props
    }
  );
}

// providers/theme.tsx
var import_next_themes2 = require("next-themes");
var NextThemeProvider = import_next_themes2.ThemeProvider;
var ThemeProvider = ({
  children,
  ...properties
}) => /* @__PURE__ */ React.createElement(
  NextThemeProvider,
  {
    attribute: "class",
    defaultTheme: "system",
    disableTransitionOnChange: true,
    enableSystem: true,
    ...properties
  },
  children
);

// index.tsx
var DesignSystemProvider = ({
  children,
  ...properties
}) => /* @__PURE__ */ React.createElement(ThemeProvider, { ...properties }, /* @__PURE__ */ React.createElement(TooltipProvider, null, children), /* @__PURE__ */ React.createElement(Toaster, null));
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DesignSystemProvider
});
//# sourceMappingURL=index.js.map