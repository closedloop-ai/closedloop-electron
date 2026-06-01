var React = require("react");
"use strict";
"use client";
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

// components/ui/metadata-panel.tsx
var metadata_panel_exports = {};
__export(metadata_panel_exports, {
  MetadataPanel: () => MetadataPanel,
  MetadataSection: () => MetadataSection,
  TabbedMetadataPanel: () => TabbedMetadataPanel
});
module.exports = __toCommonJS(metadata_panel_exports);

// components/ui/tabs.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/tabs.tsx
function Tabs({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.Tabs.Root,
    {
      "data-slot": "tabs",
      className: cn("flex flex-col gap-2", className),
      ...props
    }
  );
}
function TabsList({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.Tabs.List,
    {
      "data-slot": "tabs-list",
      className: cn(
        "bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]",
        className
      ),
      ...props
    }
  );
}
function TabsTrigger({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.Tabs.Trigger,
    {
      "data-slot": "tabs-trigger",
      className: cn(
        "data-[state=active]:bg-background dark:data-[state=active]:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring dark:data-[state=active]:border-input-border dark:data-[state=active]:bg-input text-foreground dark:text-muted-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      ),
      ...props
    }
  );
}
function TabsContent({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.Tabs.Content,
    {
      "data-slot": "tabs-content",
      className: cn("flex-1 outline-none", className),
      ...props
    }
  );
}

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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MetadataPanel,
  MetadataSection,
  TabbedMetadataPanel
});
//# sourceMappingURL=metadata-panel.js.map