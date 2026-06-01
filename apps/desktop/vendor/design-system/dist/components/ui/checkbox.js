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

// components/ui/checkbox.tsx
var checkbox_exports = {};
__export(checkbox_exports, {
  Checkbox: () => Checkbox
});
module.exports = __toCommonJS(checkbox_exports);
var React = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_lucide_react = require("lucide-react");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/checkbox.tsx
function Checkbox({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    import_radix_ui.Checkbox.Root,
    {
      "data-slot": "checkbox",
      className: cn(
        "group/checkbox peer border-input-border bg-input dark:bg-input data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React.createElement(
      import_radix_ui.Checkbox.Indicator,
      {
        "data-slot": "checkbox-indicator",
        className: "grid place-content-center text-current transition-none"
      },
      /* @__PURE__ */ React.createElement(import_lucide_react.CheckIcon, { className: "size-3 group-data-[state=indeterminate]/checkbox:hidden", strokeWidth: 3 }),
      /* @__PURE__ */ React.createElement(import_lucide_react.MinusIcon, { className: "hidden size-3 group-data-[state=indeterminate]/checkbox:block", strokeWidth: 3 })
    )
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Checkbox
});
//# sourceMappingURL=checkbox.js.map