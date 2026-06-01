var React = require("react");
"use strict";
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

// providers/theme.tsx
var theme_exports = {};
__export(theme_exports, {
  ThemeProvider: () => ThemeProvider
});
module.exports = __toCommonJS(theme_exports);
var import_next_themes = require("next-themes");
var NextThemeProvider = import_next_themes.ThemeProvider;
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ThemeProvider
});
//# sourceMappingURL=theme.js.map