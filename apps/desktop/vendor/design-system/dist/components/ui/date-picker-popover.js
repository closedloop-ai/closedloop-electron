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

// components/ui/date-picker-popover.tsx
var date_picker_popover_exports = {};
__export(date_picker_popover_exports, {
  DatePickerPopover: () => DatePickerPopover
});
module.exports = __toCommonJS(date_picker_popover_exports);
var React4 = __toESM(require("react"));
var import_lucide_react2 = require("lucide-react");
var import_date_fns = require("date-fns");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/button.tsx
var React = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");
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

// components/ui/popover.tsx
var React2 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
function Popover({
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(import_radix_ui2.Popover.Root, { "data-slot": "popover", ...props });
}
function PopoverTrigger({
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(import_radix_ui2.Popover.Trigger, { "data-slot": "popover-trigger", ...props });
}
function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(import_radix_ui2.Popover.Portal, null, /* @__PURE__ */ React2.createElement(
    import_radix_ui2.Popover.Content,
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

// components/ui/calendar.tsx
var React3 = __toESM(require("react"));
var import_lucide_react = require("lucide-react");
var import_react_day_picker = require("react-day-picker");
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}) {
  const defaultClassNames = (0, import_react_day_picker.getDefaultClassNames)();
  return /* @__PURE__ */ React3.createElement(
    import_react_day_picker.DayPicker,
    {
      showOutsideDays,
      className: cn(
        "bg-background group/calendar p-3 [--cell-size:--spacing(8)] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      ),
      captionLayout,
      formatters: {
        formatMonthDropdown: (date) => date.toLocaleString("default", { month: "short" }),
        ...formatters
      },
      classNames: {
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "flex gap-4 flex-col md:flex-row relative",
          defaultClassNames.months
        ),
        month: cn("flex flex-col w-full gap-4", defaultClassNames.month),
        nav: cn(
          "flex items-center gap-1 w-full absolute top-0 inset-x-0 justify-between",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) aria-disabled:opacity-50 p-0 select-none",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) aria-disabled:opacity-50 p-0 select-none",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex items-center justify-center h-(--cell-size) w-full px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "w-full flex items-center text-sm font-medium justify-center h-(--cell-size) gap-1.5",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          "relative has-focus:border-ring border border-input-border shadow-xs has-focus:ring-ring/50 has-focus:ring-[3px] rounded-md",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          "absolute bg-popover inset-0 opacity-0",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "select-none font-medium",
          captionLayout === "label" ? "text-sm" : "rounded-md pl-2 pr-1 flex items-center gap-1 text-sm h-8 [&>svg]:text-muted-foreground [&>svg]:size-3.5",
          defaultClassNames.caption_label
        ),
        table: "w-full border-collapse",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "text-muted-foreground rounded-md flex-1 font-normal text-[0.8rem] select-none",
          defaultClassNames.weekday
        ),
        week: cn("flex w-full mt-2", defaultClassNames.week),
        week_number_header: cn(
          "select-none w-(--cell-size)",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "text-[0.8rem] select-none text-muted-foreground",
          defaultClassNames.week_number
        ),
        day: cn(
          "relative w-full h-full p-0 text-center [&:last-child[data-selected=true]_button]:rounded-r-md group/day aspect-square select-none",
          props.showWeekNumber ? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-md" : "[&:first-child[data-selected=true]_button]:rounded-l-md",
          defaultClassNames.day
        ),
        range_start: cn(
          "rounded-l-md bg-accent",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn("rounded-r-md bg-accent", defaultClassNames.range_end),
        today: cn(
          "bg-accent text-accent-foreground rounded-md data-[selected=true]:rounded-none",
          defaultClassNames.today
        ),
        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames
      },
      components: {
        Root: ({ className: className2, rootRef, ...props2 }) => {
          return /* @__PURE__ */ React3.createElement(
            "div",
            {
              "data-slot": "calendar",
              ref: rootRef,
              className: cn(className2),
              ...props2
            }
          );
        },
        Chevron: ({ className: className2, orientation, ...props2 }) => {
          if (orientation === "left") {
            return /* @__PURE__ */ React3.createElement(import_lucide_react.ChevronLeftIcon, { className: cn("size-4", className2), ...props2 });
          }
          if (orientation === "right") {
            return /* @__PURE__ */ React3.createElement(
              import_lucide_react.ChevronRightIcon,
              {
                className: cn("size-4", className2),
                ...props2
              }
            );
          }
          return /* @__PURE__ */ React3.createElement(import_lucide_react.ChevronDownIcon, { className: cn("size-4", className2), ...props2 });
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...props2 }) => {
          return /* @__PURE__ */ React3.createElement("td", { ...props2 }, /* @__PURE__ */ React3.createElement("div", { className: "flex size-(--cell-size) items-center justify-center text-center" }, children));
        },
        ...components
      },
      ...props
    }
  );
}
function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}) {
  const defaultClassNames = (0, import_react_day_picker.getDefaultClassNames)();
  const ref = React3.useRef(null);
  React3.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);
  return /* @__PURE__ */ React3.createElement(
    Button,
    {
      ref,
      variant: "ghost",
      size: "icon",
      "data-day": day.date.toLocaleDateString(),
      "data-selected-single": modifiers.selected && !modifiers.range_start && !modifiers.range_end && !modifiers.range_middle,
      "data-range-start": modifiers.range_start,
      "data-range-end": modifiers.range_end,
      "data-range-middle": modifiers.range_middle,
      className: cn(
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-ring/50 dark:hover:text-accent-foreground flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] data-[range-end=true]:rounded-md data-[range-end=true]:rounded-r-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md data-[range-start=true]:rounded-l-md [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className
      ),
      ...props
    }
  );
}

// components/ui/date-picker-popover.tsx
function DatePickerPopover({
  value,
  onSelect,
  placeholder = "Select date...",
  iconOnly = false,
  trigger,
  disabled = false,
  className,
  dateFormat = "MMM d, yyyy",
  fromDate,
  toDate
}) {
  const [open, setOpen] = React4.useState(false);
  const handleSelect = (date) => {
    onSelect(date || null);
    setOpen(false);
  };
  const handleClear = (e) => {
    e.stopPropagation();
    onSelect(null);
  };
  const defaultTrigger = iconOnly ? /* @__PURE__ */ React4.createElement(
    Button,
    {
      variant: "ghost",
      size: "icon",
      className: cn("h-8 w-8 text-muted-foreground hover:text-foreground", className),
      disabled
    },
    /* @__PURE__ */ React4.createElement(import_lucide_react2.CalendarIcon, { className: "h-4 w-4" }),
    /* @__PURE__ */ React4.createElement("span", { className: "sr-only" }, placeholder)
  ) : /* @__PURE__ */ React4.createElement(
    Button,
    {
      variant: "outline",
      role: "combobox",
      "aria-expanded": open,
      className: cn(
        "w-[200px] justify-start text-left font-normal",
        !value && "text-muted-foreground",
        className
      ),
      disabled
    },
    /* @__PURE__ */ React4.createElement(import_lucide_react2.CalendarIcon, { className: "mr-2 h-4 w-4" }),
    value ? /* @__PURE__ */ React4.createElement("div", { className: "flex items-center justify-between flex-1" }, /* @__PURE__ */ React4.createElement("span", null, (0, import_date_fns.format)(value, dateFormat)), /* @__PURE__ */ React4.createElement(
      import_lucide_react2.XIcon,
      {
        className: "h-4 w-4 opacity-50 hover:opacity-100",
        onClick: handleClear
      }
    )) : /* @__PURE__ */ React4.createElement("span", null, placeholder)
  );
  return /* @__PURE__ */ React4.createElement(Popover, { open, onOpenChange: setOpen }, /* @__PURE__ */ React4.createElement(PopoverTrigger, { asChild: true }, trigger || defaultTrigger), /* @__PURE__ */ React4.createElement(PopoverContent, { className: "w-auto p-0", align: "start" }, /* @__PURE__ */ React4.createElement(
    Calendar,
    {
      mode: "single",
      selected: value || void 0,
      onSelect: handleSelect,
      initialFocus: true,
      disabled: fromDate && toDate ? { before: fromDate, after: toDate } : fromDate ? { before: fromDate } : toDate ? { after: toDate } : void 0
    }
  ), value && /* @__PURE__ */ React4.createElement("div", { className: "border-t p-2" }, /* @__PURE__ */ React4.createElement(
    Button,
    {
      variant: "ghost",
      size: "sm",
      className: "w-full text-muted-foreground",
      onClick: () => {
        onSelect(null);
        setOpen(false);
      }
    },
    "Clear date"
  ))));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DatePickerPopover
});
//# sourceMappingURL=date-picker-popover.js.map