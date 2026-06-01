var React = require("react");
"use strict";
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

// components/ui/chip.tsx
var chip_exports = {};
__export(chip_exports, {
  Chip: () => Chip,
  chipVariants: () => chipVariants
});
module.exports = __toCommonJS(chip_exports);
var React = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/chip.tsx
var chipVariants = (0, import_class_variance_authority.cva)(
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
  const Comp = asChild ? import_radix_ui.Slot.Slot : "span";
  return /* @__PURE__ */ React.createElement(
    Comp,
    {
      className: cn(chipVariants({ variant, size, interactive }), className),
      "data-slot": "chip",
      ...props
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Chip,
  chipVariants
});
//# sourceMappingURL=chip.js.map