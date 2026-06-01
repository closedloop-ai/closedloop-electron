import React from "react";
import {
  cn
} from "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-LZOMFHX3.mjs";

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
export {
  ListItem
};
//# sourceMappingURL=list-item.mjs.map