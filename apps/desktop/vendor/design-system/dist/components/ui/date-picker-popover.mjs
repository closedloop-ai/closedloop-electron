"use client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "../../chunk-547UMAL4.mjs";
import {
  Calendar
} from "../../chunk-7SZ2QAX4.mjs";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/date-picker-popover.tsx
import * as React from "react";
import { CalendarIcon, XIcon } from "lucide-react";
import { format } from "date-fns";
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
  const [open, setOpen] = React.useState(false);
  const handleSelect = (date) => {
    onSelect(date || null);
    setOpen(false);
  };
  const handleClear = (e) => {
    e.stopPropagation();
    onSelect(null);
  };
  const defaultTrigger = iconOnly ? /* @__PURE__ */ React.createElement(
    Button,
    {
      variant: "ghost",
      size: "icon",
      className: cn("h-8 w-8 text-muted-foreground hover:text-foreground", className),
      disabled
    },
    /* @__PURE__ */ React.createElement(CalendarIcon, { className: "h-4 w-4" }),
    /* @__PURE__ */ React.createElement("span", { className: "sr-only" }, placeholder)
  ) : /* @__PURE__ */ React.createElement(
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
    /* @__PURE__ */ React.createElement(CalendarIcon, { className: "mr-2 h-4 w-4" }),
    value ? /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between flex-1" }, /* @__PURE__ */ React.createElement("span", null, format(value, dateFormat)), /* @__PURE__ */ React.createElement(
      XIcon,
      {
        className: "h-4 w-4 opacity-50 hover:opacity-100",
        onClick: handleClear
      }
    )) : /* @__PURE__ */ React.createElement("span", null, placeholder)
  );
  return /* @__PURE__ */ React.createElement(Popover, { open, onOpenChange: setOpen }, /* @__PURE__ */ React.createElement(PopoverTrigger, { asChild: true }, trigger || defaultTrigger), /* @__PURE__ */ React.createElement(PopoverContent, { className: "w-auto p-0", align: "start" }, /* @__PURE__ */ React.createElement(
    Calendar,
    {
      mode: "single",
      selected: value || void 0,
      onSelect: handleSelect,
      initialFocus: true,
      disabled: fromDate && toDate ? { before: fromDate, after: toDate } : fromDate ? { before: fromDate } : toDate ? { after: toDate } : void 0
    }
  ), value && /* @__PURE__ */ React.createElement("div", { className: "border-t p-2" }, /* @__PURE__ */ React.createElement(
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
export {
  DatePickerPopover
};
//# sourceMappingURL=date-picker-popover.mjs.map