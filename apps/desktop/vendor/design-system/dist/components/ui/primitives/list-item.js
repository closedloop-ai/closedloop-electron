var React = require("react");
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// components/ui/primitives/list-item.tsx
var list_item_exports = {};
__export(list_item_exports, {
  ListItem: () => ListItem
});
module.exports = __toCommonJS(list_item_exports);

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/primitives/list-item.tsx
function ListItem({
  title,
  meta,
  detail,
  active = false,
  onClick,
  className
}) {
  const Comp = onClick ? "button" : "div";
  return /* @__PURE__ */ React.createElement(
    Comp,
    {
      className: cn(
        "block w-full rounded-lg border px-3 py-2 text-left transition-colors",
        active ? "border-primary/30 bg-primary/10" : "border-border bg-surface-2 hover:bg-surface-3",
        className
      ),
      onClick,
      type: onClick ? "button" : void 0
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-start justify-between gap-2" }, /* @__PURE__ */ React.createElement("div", { className: "min-w-0 flex-1 font-medium text-foreground text-sm" }, title), meta ? /* @__PURE__ */ React.createElement("div", { className: "shrink-0" }, meta) : null),
    detail ? /* @__PURE__ */ React.createElement("div", { className: "mt-1 text-[11px] text-muted-foreground" }, detail) : null
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ListItem
});
//# sourceMappingURL=list-item.js.map