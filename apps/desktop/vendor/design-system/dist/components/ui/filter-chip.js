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

// components/ui/filter-chip.tsx
var filter_chip_exports = {};
__export(filter_chip_exports, {
  FilterChip: () => FilterChip
});
module.exports = __toCommonJS(filter_chip_exports);

// components/ui/dropdown-menu.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_lucide_react = require("lucide-react");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/dropdown-menu.tsx
function DropdownMenu({
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(import_radix_ui.DropdownMenu.Root, { "data-slot": "dropdown-menu", ...props });
}
function DropdownMenuTrigger({
  id: idProp,
  ...props
}) {
  const stableId = React2.useId();
  const id = idProp ?? stableId;
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.DropdownMenu.Trigger,
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
  return /* @__PURE__ */ React2.createElement(import_radix_ui.DropdownMenu.Portal, null, /* @__PURE__ */ React2.createElement(
    import_radix_ui.DropdownMenu.Content,
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

// components/ui/filter-chip.tsx
var import_lucide_react2 = require("lucide-react");
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
      /* @__PURE__ */ React.createElement(import_lucide_react2.XIcon, { className: "size-3" })
    )
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FilterChip
});
//# sourceMappingURL=filter-chip.js.map