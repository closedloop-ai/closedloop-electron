import React from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "./chunk-76IVWEZL.mjs";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/metadata-panel.tsx
function MetadataPanel({
  title,
  children,
  className,
  variant = "sidebar"
}) {
  if (variant === "bar") {
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cn(
          "flex flex-wrap items-center gap-2 bg-background py-2",
          className
        )
      },
      children
    );
  }
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "min-h-0 w-80 overflow-auto border-l bg-background p-4",
        className
      )
    },
    title ? /* @__PURE__ */ React.createElement("h3", { className: "mb-4 font-semibold" }, title) : null,
    /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, children)
  );
}
function MetadataSection({
  children,
  separator,
  className,
  layout = "vertical"
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        layout === "horizontal" ? "flex flex-wrap items-center gap-2" : "space-y-2",
        layout === "vertical" && separator ? "border-t pt-4" : null,
        className
      )
    },
    children
  );
}
function TabbedMetadataPanel({
  tabs,
  className,
  defaultTab
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn("w-80 overflow-auto border-l bg-background p-4", className)
    },
    /* @__PURE__ */ React.createElement(Tabs, { defaultValue: defaultTab ?? tabs[0]?.id }, /* @__PURE__ */ React.createElement(TabsList, { className: "mb-4 w-full" }, tabs.map((tab) => /* @__PURE__ */ React.createElement(TabsTrigger, { className: "flex-1", key: tab.id, value: tab.id }, tab.label))), tabs.map((tab) => /* @__PURE__ */ React.createElement(TabsContent, { key: tab.id, value: tab.id }, tab.content)))
  );
}

export {
  MetadataPanel,
  MetadataSection,
  TabbedMetadataPanel
};
//# sourceMappingURL=chunk-ZOB3YFAZ.mjs.map