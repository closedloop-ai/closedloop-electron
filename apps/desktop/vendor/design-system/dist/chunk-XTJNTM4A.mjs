import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from "./chunk-M266NC23.mjs";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/filter-chip.tsx
import { XIcon } from "lucide-react";
function FilterChip({
  label,
  onRemove,
  children,
  dropdownClassName,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "inline-flex items-center overflow-hidden rounded-md border text-xs",
        className
      )
    },
    children ? /* @__PURE__ */ React.createElement(DropdownMenu, null, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "flex max-w-[160px] items-center gap-1 px-2 py-1 hover:bg-muted",
        type: "button"
      },
      /* @__PURE__ */ React.createElement("span", { className: "truncate" }, label)
    )), /* @__PURE__ */ React.createElement(
      DropdownMenuContent,
      {
        align: "start",
        className: cn("w-60", dropdownClassName)
      },
      children
    )) : /* @__PURE__ */ React.createElement("span", { className: "flex max-w-[160px] items-center gap-1 px-2 py-1" }, /* @__PURE__ */ React.createElement("span", { className: "truncate" }, label)),
    /* @__PURE__ */ React.createElement(
      "button",
      {
        "aria-label": `Remove ${label} filter`,
        className: "flex items-center self-stretch border-l px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
        onClick: (e) => {
          e.stopPropagation();
          onRemove();
        },
        type: "button"
      },
      /* @__PURE__ */ React.createElement(XIcon, { className: "size-3" })
    )
  );
}

export {
  FilterChip
};
//# sourceMappingURL=chunk-XTJNTM4A.mjs.map