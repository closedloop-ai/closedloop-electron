import React from "react";
// providers/theme.tsx
import { ThemeProvider as BaseThemeProvider } from "next-themes";
var NextThemeProvider = BaseThemeProvider;
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

export {
  ThemeProvider
};
//# sourceMappingURL=chunk-Z5INIPT3.mjs.map