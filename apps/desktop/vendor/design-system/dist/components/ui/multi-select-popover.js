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

// components/ui/multi-select-popover.tsx
var multi_select_popover_exports = {};
__export(multi_select_popover_exports, {
  MultiSelectPopover: () => MultiSelectPopover
});
module.exports = __toCommonJS(multi_select_popover_exports);
var React6 = __toESM(require("react"));
var import_lucide_react3 = require("lucide-react");

// components/ui/button.tsx
var React = __toESM(require("react"));
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
  return /* @__PURE__ */ React.createElement(
    Comp,
    {
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size, className })),
      ...props
    }
  );
}

// components/ui/chip.tsx
var React2 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_class_variance_authority2 = require("class-variance-authority");
var chipVariants = (0, import_class_variance_authority2.cva)(
  "inline-flex max-w-full items-center justify-center gap-1 rounded-full border font-medium whitespace-nowrap shrink-0 transition-[color,box-shadow,background-color] overflow-hidden [&>svg]:shrink-0 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-destructive/25 bg-destructive/12 text-destructive",
        success: "border-success/25 bg-success/12 text-success",
        warning: "border-warning/30 bg-warning/14 text-warning-foreground",
        info: "border-info/25 bg-info/12 text-info",
        accent: "border-primary/20 bg-primary/10 text-primary",
        muted: "border-border bg-muted/70 text-muted-foreground",
        outline: "border-input-border bg-input text-foreground"
      },
      size: {
        sm: "h-5 px-1.5 text-[11px] [&>svg]:size-3",
        default: "h-6 px-2.5 text-xs [&>svg]:size-3.5",
        lg: "h-7 px-3 text-sm [&>svg]:size-4"
      },
      interactive: {
        true: "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none [a&]:hover:bg-muted [button&]:hover:bg-muted",
        false: ""
      }
    },
    defaultVariants: {
      variant: "muted",
      size: "default",
      interactive: false
    }
  }
);
function Chip({
  className,
  variant,
  size,
  interactive,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? import_radix_ui2.Slot.Slot : "span";
  return /* @__PURE__ */ React2.createElement(
    Comp,
    {
      className: cn(chipVariants({ variant, size, interactive }), className),
      "data-slot": "chip",
      ...props
    }
  );
}

// components/ui/command.tsx
var React4 = __toESM(require("react"));
var import_cmdk = require("cmdk");
var import_lucide_react2 = require("lucide-react");

// components/ui/dialog.tsx
var React3 = __toESM(require("react"));
var import_radix_ui3 = require("radix-ui");
var import_lucide_react = require("lucide-react");

// components/ui/command.tsx
function Command({
  className,
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(
    import_cmdk.Command,
    {
      "data-slot": "command",
      className: cn(
        "bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md",
        className
      ),
      ...props
    }
  );
}
function CommandInput({
  className,
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(
    "div",
    {
      "data-slot": "command-input-wrapper",
      className: "flex h-9 items-center gap-2 border-b px-3"
    },
    /* @__PURE__ */ React4.createElement(import_lucide_react2.SearchIcon, { className: "size-4 shrink-0 opacity-50" }),
    /* @__PURE__ */ React4.createElement(
      import_cmdk.Command.Input,
      {
        "data-slot": "command-input",
        className: cn(
          "placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
          className
        ),
        ...props
      }
    )
  );
}
function CommandList({
  className,
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(
    import_cmdk.Command.List,
    {
      "data-slot": "command-list",
      className: cn(
        "max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto",
        className
      ),
      ...props
    }
  );
}
function CommandEmpty({
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(
    import_cmdk.Command.Empty,
    {
      "data-slot": "command-empty",
      className: "py-6 text-center text-sm",
      ...props
    }
  );
}
function CommandGroup({
  className,
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(
    import_cmdk.Command.Group,
    {
      "data-slot": "command-group",
      className: cn(
        "text-foreground [&_[cmdk-group-heading]]:text-muted-foreground overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium",
        className
      ),
      ...props
    }
  );
}
function CommandItem({
  className,
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(
    import_cmdk.Command.Item,
    {
      "data-slot": "command-item",
      className: cn(
        "data-[selected=true]:bg-muted data-[selected=true]:text-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      ),
      ...props
    }
  );
}

// components/ui/popover.tsx
var React5 = __toESM(require("react"));
var import_radix_ui4 = require("radix-ui");
function Popover({
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(import_radix_ui4.Popover.Root, { "data-slot": "popover", ...props });
}
function PopoverTrigger({
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(import_radix_ui4.Popover.Trigger, { "data-slot": "popover-trigger", ...props });
}
function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(import_radix_ui4.Popover.Portal, null, /* @__PURE__ */ React5.createElement(
    import_radix_ui4.Popover.Content,
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

// components/ui/multi-select-popover.tsx
function MultiSelectPopover({
  value,
  options,
  onChange,
  placeholder = "Select options",
  searchPlaceholder = "Search options...",
  emptyText = "No options found.",
  className,
  contentClassName,
  disabled = false
}) {
  const [open, setOpen] = React6.useState(false);
  const selectedLabels = React6.useMemo(() => {
    const selected = new Set(value);
    return options.filter((option) => selected.has(option.value)).map((option) => option.label);
  }, [options, value]);
  const handleToggle = React6.useCallback(
    (optionValue) => {
      if (!onChange) {
        return;
      }
      const next = value.includes(optionValue) ? value.filter((item) => item !== optionValue) : [...value, optionValue];
      onChange(next);
    },
    [onChange, value]
  );
  return /* @__PURE__ */ React6.createElement(Popover, { onOpenChange: setOpen, open }, /* @__PURE__ */ React6.createElement(PopoverTrigger, { asChild: true }, /* @__PURE__ */ React6.createElement(
    Button,
    {
      "aria-expanded": open,
      className: cn(
        "h-auto min-h-9 w-full justify-between gap-2 px-3 py-2 text-left font-normal",
        className
      ),
      disabled,
      role: "combobox",
      variant: "outline"
    },
    /* @__PURE__ */ React6.createElement("span", { className: "min-w-0 flex-1" }, selectedLabels.length > 0 ? /* @__PURE__ */ React6.createElement("span", { className: "flex flex-wrap gap-1" }, selectedLabels.slice(0, 2).map((label) => /* @__PURE__ */ React6.createElement(Chip, { key: label, size: "sm", variant: "accent" }, label)), selectedLabels.length > 2 ? /* @__PURE__ */ React6.createElement(Chip, { size: "sm", variant: "muted" }, "+", selectedLabels.length - 2) : null) : /* @__PURE__ */ React6.createElement("span", { className: "text-muted-foreground" }, placeholder)),
    /* @__PURE__ */ React6.createElement(import_lucide_react3.ChevronDown, { className: "size-4 shrink-0 text-muted-foreground" })
  )), /* @__PURE__ */ React6.createElement(
    PopoverContent,
    {
      align: "start",
      className: cn("w-[280px] p-0", contentClassName)
    },
    /* @__PURE__ */ React6.createElement(Command, null, /* @__PURE__ */ React6.createElement(CommandInput, { placeholder: searchPlaceholder }), /* @__PURE__ */ React6.createElement(CommandList, null, /* @__PURE__ */ React6.createElement(CommandEmpty, null, emptyText), /* @__PURE__ */ React6.createElement(CommandGroup, null, options.map((option) => {
      const selected = value.includes(option.value);
      return /* @__PURE__ */ React6.createElement(
        CommandItem,
        {
          key: option.value,
          keywords: option.keywords,
          onSelect: () => handleToggle(option.value),
          value: `${option.label} ${option.value}`
        },
        /* @__PURE__ */ React6.createElement(
          import_lucide_react3.Check,
          {
            className: cn(
              "mr-2 size-4",
              selected ? "opacity-100" : "opacity-0"
            )
          }
        ),
        /* @__PURE__ */ React6.createElement("span", { className: "truncate" }, option.label)
      );
    }))))
  ));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MultiSelectPopover
});
//# sourceMappingURL=multi-select-popover.js.map