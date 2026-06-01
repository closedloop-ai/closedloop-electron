"use client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "../../chunk-547UMAL4.mjs";
import {
  Chip
} from "../../chunk-TX5PRGT7.mjs";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "../../chunk-ST5QOYCX.mjs";
import "../../chunk-6LPHEING.mjs";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/multi-select-popover.tsx
import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
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
  const [open, setOpen] = React.useState(false);
  const selectedLabels = React.useMemo(() => {
    const selected = new Set(value);
    return options.filter((option) => selected.has(option.value)).map((option) => option.label);
  }, [options, value]);
  const handleToggle = React.useCallback(
    (optionValue) => {
      if (!onChange) {
        return;
      }
      const next = value.includes(optionValue) ? value.filter((item) => item !== optionValue) : [...value, optionValue];
      onChange(next);
    },
    [onChange, value]
  );
  return /* @__PURE__ */ React.createElement(Popover, { onOpenChange: setOpen, open }, /* @__PURE__ */ React.createElement(PopoverTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(
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
    /* @__PURE__ */ React.createElement("span", { className: "min-w-0 flex-1" }, selectedLabels.length > 0 ? /* @__PURE__ */ React.createElement("span", { className: "flex flex-wrap gap-1" }, selectedLabels.slice(0, 2).map((label) => /* @__PURE__ */ React.createElement(Chip, { key: label, size: "sm", variant: "accent" }, label)), selectedLabels.length > 2 ? /* @__PURE__ */ React.createElement(Chip, { size: "sm", variant: "muted" }, "+", selectedLabels.length - 2) : null) : /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground" }, placeholder)),
    /* @__PURE__ */ React.createElement(ChevronDown, { className: "size-4 shrink-0 text-muted-foreground" })
  )), /* @__PURE__ */ React.createElement(
    PopoverContent,
    {
      align: "start",
      className: cn("w-[280px] p-0", contentClassName)
    },
    /* @__PURE__ */ React.createElement(Command, null, /* @__PURE__ */ React.createElement(CommandInput, { placeholder: searchPlaceholder }), /* @__PURE__ */ React.createElement(CommandList, null, /* @__PURE__ */ React.createElement(CommandEmpty, null, emptyText), /* @__PURE__ */ React.createElement(CommandGroup, null, options.map((option) => {
      const selected = value.includes(option.value);
      return /* @__PURE__ */ React.createElement(
        CommandItem,
        {
          key: option.value,
          keywords: option.keywords,
          onSelect: () => handleToggle(option.value),
          value: `${option.label} ${option.value}`
        },
        /* @__PURE__ */ React.createElement(
          Check,
          {
            className: cn(
              "mr-2 size-4",
              selected ? "opacity-100" : "opacity-0"
            )
          }
        ),
        /* @__PURE__ */ React.createElement("span", { className: "truncate" }, option.label)
      );
    }))))
  ));
}
export {
  MultiSelectPopover
};
//# sourceMappingURL=multi-select-popover.mjs.map