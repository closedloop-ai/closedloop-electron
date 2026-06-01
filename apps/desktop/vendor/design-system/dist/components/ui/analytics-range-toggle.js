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

// components/ui/analytics-range-toggle.tsx
var analytics_range_toggle_exports = {};
__export(analytics_range_toggle_exports, {
  AnalyticsRangeToggle: () => AnalyticsRangeToggle
});
module.exports = __toCommonJS(analytics_range_toggle_exports);

// components/ui/toggle-group.tsx
var React3 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/toggle.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");
var toggleVariants = (0, import_class_variance_authority.cva)(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-muted data-[state=on]:text-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none transition-[color,box-shadow] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input-border bg-transparent hover:bg-muted hover:text-foreground"
      },
      size: {
        default: "h-9 px-2 min-w-9",
        sm: "h-8 px-1.5 min-w-8",
        lg: "h-10 px-2.5 min-w-10"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

// components/ui/toggle-group.tsx
var ToggleGroupContext = React3.createContext({
  size: "default",
  variant: "default",
  spacing: 0
});
function ToggleGroup({
  className,
  variant,
  size,
  spacing = 0,
  children,
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui2.ToggleGroup.Root,
    {
      "data-slot": "toggle-group",
      "data-variant": variant,
      "data-size": size,
      "data-spacing": spacing,
      style: { "--gap": spacing },
      className: cn(
        "group/toggle-group flex w-fit items-center gap-[--spacing(var(--gap))] rounded-md data-[spacing=default]:data-[variant=outline]:shadow-xs",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React3.createElement(ToggleGroupContext.Provider, { value: { variant, size, spacing } }, children)
  );
}
function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}) {
  const context = React3.useContext(ToggleGroupContext);
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui2.ToggleGroup.Item,
    {
      "data-slot": "toggle-group-item",
      "data-variant": context.variant || variant,
      "data-size": context.size || size,
      "data-spacing": context.spacing,
      className: cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size
        }),
        "w-auto min-w-0 shrink-0 px-3 focus:z-10 focus-visible:z-10",
        "data-[spacing=0]:rounded-none data-[spacing=0]:shadow-none data-[spacing=0]:first:rounded-l-md data-[spacing=0]:last:rounded-r-md data-[spacing=0]:data-[variant=outline]:border-l-0 data-[spacing=0]:data-[variant=outline]:first:border-l",
        className
      ),
      ...props
    },
    children
  );
}

// components/ui/analytics-range-toggle.tsx
function AnalyticsRangeToggle({
  label = "Range",
  options,
  value,
  onValueChange,
  className
}) {
  return /* @__PURE__ */ React.createElement("div", { className: className ?? "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "mr-2 font-medium text-slate-400 text-xs uppercase tracking-wider" }, label), /* @__PURE__ */ React.createElement(
    ToggleGroup,
    {
      className: "gap-1",
      onValueChange: (nextValue) => {
        if (nextValue) {
          onValueChange?.(nextValue);
        }
      },
      size: "sm",
      type: "single",
      value,
      variant: "outline"
    },
    options.map((option) => /* @__PURE__ */ React.createElement(
      ToggleGroupItem,
      {
        className: "border-slate-700 bg-transparent text-slate-400 hover:text-white data-[state=on]:border-emerald-500/60 data-[state=on]:bg-emerald-600 data-[state=on]:text-white",
        key: option.value,
        value: option.value
      },
      option.label
    ))
  ));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AnalyticsRangeToggle
});
//# sourceMappingURL=analytics-range-toggle.js.map