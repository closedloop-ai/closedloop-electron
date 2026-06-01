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

// components/ui/table-view-menu.tsx
var table_view_menu_exports = {};
__export(table_view_menu_exports, {
  TableViewMenu: () => TableViewMenu
});
module.exports = __toCommonJS(table_view_menu_exports);

// components/ui/button.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/button.tsx
var buttonVariants = (0, import_class_variance_authority.cva)(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline: "border border-input-border bg-input hover:bg-muted hover:text-foreground dark:bg-input dark:hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4 gap-2 py-2 has-[>svg]:px-3 [&_svg:not([class*='size-'])]:size-4",
        sm: "h-8 rounded-md gap-2 px-3 has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 rounded-md gap-2 px-6 has-[>svg]:px-4 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-9 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-4"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);
function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? import_radix_ui.Slot.Slot : "button";
  return /* @__PURE__ */ React2.createElement(
    Comp,
    {
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size, className })),
      ...props
    }
  );
}

// components/ui/dropdown-menu.tsx
var React3 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_lucide_react = require("lucide-react");
function DropdownMenu({
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(import_radix_ui2.DropdownMenu.Root, { "data-slot": "dropdown-menu", ...props });
}
function DropdownMenuTrigger({
  id: idProp,
  ...props
}) {
  const stableId = React3.useId();
  const id = idProp ?? stableId;
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui2.DropdownMenu.Trigger,
    {
      "data-slot": "dropdown-menu-trigger",
      ...props,
      id
    }
  );
}
function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(import_radix_ui2.DropdownMenu.Portal, null, /* @__PURE__ */ React3.createElement(
    import_radix_ui2.DropdownMenu.Content,
    {
      "data-slot": "dropdown-menu-content",
      sideOffset,
      className: cn(
        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md",
        className
      ),
      ...props
    }
  ));
}
function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui2.DropdownMenu.Item,
    {
      "data-slot": "dropdown-menu-item",
      "data-inset": inset,
      "data-variant": variant,
      className: cn(
        "focus:!bg-muted focus:text-foreground data-[highlighted]:!bg-muted hover:!bg-muted hover:text-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:hover:!bg-destructive/8 data-[variant=destructive]:focus:!bg-destructive/8 data-[variant=destructive]:data-[highlighted]:!bg-destructive/8 dark:data-[variant=destructive]:hover:!bg-destructive/8 dark:data-[variant=destructive]:focus:!bg-destructive/8 dark:data-[variant=destructive]:data-[highlighted]:!bg-destructive/8 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:transition-colors hover:[&_svg:not([class*='text-'])]:text-current focus:[&_svg:not([class*='text-'])]:text-current data-[highlighted]:[&_svg:not([class*='text-'])]:text-current relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      ),
      ...props
    }
  );
}

// components/ui/popover.tsx
var React4 = __toESM(require("react"));
var import_radix_ui3 = require("radix-ui");
function Popover({
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(import_radix_ui3.Popover.Root, { "data-slot": "popover", ...props });
}
function PopoverTrigger({
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(import_radix_ui3.Popover.Trigger, { "data-slot": "popover-trigger", ...props });
}
function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(import_radix_ui3.Popover.Portal, null, /* @__PURE__ */ React4.createElement(
    import_radix_ui3.Popover.Content,
    {
      "data-slot": "popover-content",
      align,
      sideOffset,
      className: cn(
        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden",
        className
      ),
      ...props
    }
  ));
}

// components/ui/switch.tsx
var React5 = __toESM(require("react"));
var import_radix_ui4 = require("radix-ui");
function Switch({
  className,
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(
    import_radix_ui4.Switch.Root,
    {
      "data-slot": "switch",
      className: cn(
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/30 focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-muted-foreground/40 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React5.createElement(
      import_radix_ui4.Switch.Thumb,
      {
        "data-slot": "switch-thumb",
        className: cn(
          "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
        )
      }
    )
  );
}

// components/ui/toggle-group.tsx
var React7 = __toESM(require("react"));
var import_radix_ui6 = require("radix-ui");

// components/ui/toggle.tsx
var React6 = __toESM(require("react"));
var import_radix_ui5 = require("radix-ui");
var import_class_variance_authority2 = require("class-variance-authority");
var toggleVariants = (0, import_class_variance_authority2.cva)(
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
var ToggleGroupContext = React7.createContext({
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
  return /* @__PURE__ */ React7.createElement(
    import_radix_ui6.ToggleGroup.Root,
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
    /* @__PURE__ */ React7.createElement(ToggleGroupContext.Provider, { value: { variant, size, spacing } }, children)
  );
}
function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}) {
  const context = React7.useContext(ToggleGroupContext);
  return /* @__PURE__ */ React7.createElement(
    import_radix_ui6.ToggleGroup.Item,
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

// components/ui/table-view-menu.tsx
var import_lucide_react2 = require("lucide-react");
function GroupByModeSelect({
  value,
  options,
  onChange
}) {
  const selected = options.find((option) => option.value === value);
  return /* @__PURE__ */ React.createElement("div", { className: "flex flex-col px-4 pb-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex h-9 items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "text-sm" }, "Group by"), /* @__PURE__ */ React.createElement(DropdownMenu, null, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(Button, { className: "h-7 text-xs", size: "sm", variant: "outline" }, selected?.label ?? value, /* @__PURE__ */ React.createElement(import_lucide_react2.ChevronDownIcon, { className: "h-3.5 w-3.5" }))), /* @__PURE__ */ React.createElement(DropdownMenuContent, { align: "end" }, options.map((option) => /* @__PURE__ */ React.createElement(
    DropdownMenuItem,
    {
      key: option.value,
      onClick: () => onChange(option.value)
    },
    option.label
  ))))));
}
function ViewModeToggle({
  view,
  onChangeView
}) {
  return /* @__PURE__ */ React.createElement("div", { className: "px-4 pt-2 pb-4" }, /* @__PURE__ */ React.createElement(
    ToggleGroup,
    {
      className: "w-full",
      onValueChange: (value) => {
        if (value === "list" || value === "card") {
          onChangeView(value);
        }
      },
      type: "single",
      value: view,
      variant: "outline"
    },
    /* @__PURE__ */ React.createElement(ToggleGroupItem, { className: "h-7 flex-1 text-xs", value: "list" }, /* @__PURE__ */ React.createElement(import_lucide_react2.AlignLeftIcon, { className: "h-3.5 w-3.5" }), "List"),
    /* @__PURE__ */ React.createElement(ToggleGroupItem, { className: "h-7 flex-1 text-xs", value: "card" }, /* @__PURE__ */ React.createElement(import_lucide_react2.LayoutGridIcon, { className: "h-3.5 w-3.5" }), "Card")
  ));
}
function TableViewMenu({
  columns,
  onToggleColumn,
  groupByValue,
  groupByOptions,
  onChangeGroupBy,
  view,
  onChangeView,
  onResetView,
  onResetToStackRank,
  viewHeading = "View Options",
  columnsHeading = "Show/Hide Columns"
}) {
  const showViewToggle = view != null && onChangeView != null;
  const showGroupByMode = groupByValue != null && groupByOptions != null && groupByOptions.length > 0 && onChangeGroupBy != null;
  const showColumnVisibility = columns != null && columns.length > 0 && onToggleColumn != null;
  const showOptionsHeading = showViewToggle || showGroupByMode;
  const showOptionsDivider = showOptionsHeading && showColumnVisibility;
  return /* @__PURE__ */ React.createElement(Popover, null, /* @__PURE__ */ React.createElement(PopoverTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(Button, { className: "h-8 shadow-none", size: "sm", variant: "outline" }, /* @__PURE__ */ React.createElement(import_lucide_react2.Settings2Icon, null), "View")), /* @__PURE__ */ React.createElement(PopoverContent, { align: "end", className: "w-72 p-0" }, showOptionsHeading ? /* @__PURE__ */ React.createElement("div", { className: "px-4 pt-4 pb-2" }, /* @__PURE__ */ React.createElement("h4", { className: "font-semibold text-lg" }, viewHeading)) : null, showViewToggle ? /* @__PURE__ */ React.createElement(ViewModeToggle, { onChangeView, view }) : null, showGroupByMode ? /* @__PURE__ */ React.createElement(
    GroupByModeSelect,
    {
      onChange: onChangeGroupBy,
      options: groupByOptions,
      value: groupByValue
    }
  ) : null, showOptionsDivider ? /* @__PURE__ */ React.createElement("div", { className: "mx-4 border-t" }) : null, showColumnVisibility ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between px-4 pt-4 pb-2" }, /* @__PURE__ */ React.createElement("h4", { className: "font-semibold text-base" }, columnsHeading)), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col divide-y px-4 pb-3" }, columns.map((column) => /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "flex cursor-pointer items-center justify-between py-3",
      key: column.id
    },
    /* @__PURE__ */ React.createElement("span", { className: "flex items-center gap-2 text-sm" }, column.icon, column.label),
    /* @__PURE__ */ React.createElement(
      Switch,
      {
        checked: column.visible,
        id: `col-${column.id}`,
        onCheckedChange: () => onToggleColumn(column.id)
      }
    )
  )))) : null, onResetToStackRank || onResetView ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "mx-4 border-t" }), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1 px-4 py-3" }, onResetToStackRank ? /* @__PURE__ */ React.createElement(
    Button,
    {
      className: "h-7 w-full justify-start gap-2 text-muted-foreground text-xs",
      onClick: onResetToStackRank,
      size: "sm",
      variant: "ghost"
    },
    /* @__PURE__ */ React.createElement(import_lucide_react2.ListOrderedIcon, { className: "h-3.5 w-3.5" }),
    "Reset to stack rank"
  ) : null, onResetView ? /* @__PURE__ */ React.createElement(
    Button,
    {
      className: "h-7 w-full justify-start gap-2 text-muted-foreground text-xs",
      onClick: onResetView,
      size: "sm",
      variant: "ghost"
    },
    /* @__PURE__ */ React.createElement(import_lucide_react2.RotateCcwIcon, { className: "h-3.5 w-3.5" }),
    "Reset view"
  ) : null)) : null));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TableViewMenu
});
//# sourceMappingURL=table-view-menu.js.map