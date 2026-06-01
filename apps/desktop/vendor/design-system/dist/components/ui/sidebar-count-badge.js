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

// components/ui/sidebar-count-badge.tsx
var sidebar_count_badge_exports = {};
__export(sidebar_count_badge_exports, {
  SidebarCountBadge: () => SidebarCountBadge
});
module.exports = __toCommonJS(sidebar_count_badge_exports);

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/sidebar-count-badge.tsx
function SidebarCountBadge({
  count,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    "span",
    {
      className: cn(
        "ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-primary font-medium text-[10px] text-primary-foreground",
        className
      )
    },
    count
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SidebarCountBadge
});
//# sourceMappingURL=sidebar-count-badge.js.map