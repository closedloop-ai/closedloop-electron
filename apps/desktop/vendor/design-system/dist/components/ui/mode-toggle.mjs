import React from "react";
"use client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../../chunk-M266NC23.mjs";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/mode-toggle.tsx
import { MoonIcon, SunIcon } from "@radix-ui/react-icons";
import { useTheme } from "next-themes";
import { useEffect, useId, useState } from "react";
var themes = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "System", value: "system" }
];
function ModeToggle({ className }) {
  const { setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const triggerId = useId();
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) {
    return /* @__PURE__ */ React.createElement(
      Button,
      {
        className: cn("shrink-0 text-foreground", className),
        size: "icon",
        type: "button",
        variant: "ghost"
      },
      /* @__PURE__ */ React.createElement(SunIcon, { className: "h-[1.2rem] w-[1.2rem]" }),
      /* @__PURE__ */ React.createElement(MoonIcon, { className: "absolute h-[1.2rem] w-[1.2rem] opacity-0" }),
      /* @__PURE__ */ React.createElement("span", { className: "sr-only" }, "Toggle theme")
    );
  }
  return /* @__PURE__ */ React.createElement(DropdownMenu, null, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, { asChild: true, id: triggerId }, /* @__PURE__ */ React.createElement(
    Button,
    {
      className: cn("shrink-0 text-foreground", className),
      size: "icon",
      type: "button",
      variant: "ghost"
    },
    /* @__PURE__ */ React.createElement(SunIcon, { className: "h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" }),
    /* @__PURE__ */ React.createElement(MoonIcon, { className: "absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" }),
    /* @__PURE__ */ React.createElement("span", { className: "sr-only" }, "Toggle theme")
  )), /* @__PURE__ */ React.createElement(DropdownMenuContent, null, themes.map(({ label, value }) => /* @__PURE__ */ React.createElement(DropdownMenuItem, { key: value, onClick: () => setTheme(value) }, label))));
}
export {
  ModeToggle
};
//# sourceMappingURL=mode-toggle.mjs.map