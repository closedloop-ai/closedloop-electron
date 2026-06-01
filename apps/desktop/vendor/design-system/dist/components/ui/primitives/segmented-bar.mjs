import React from "react";
import {
  cn
} from "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/primitives/segmented-bar.tsx
function SegmentedBar({
  segments,
  total,
  className
}) {
  return /* @__PURE__ */ React.createElement("div", { className: cn("space-y-3", className) }, /* @__PURE__ */ React.createElement("div", { className: "flex h-2 w-full overflow-hidden rounded-full bg-muted/50" }, segments.map((segment) => {
    const pct = total > 0 ? segment.value / total * 100 : 0;
    if (pct <= 0) {
      return null;
    }
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cn(
          segment.colorClassName,
          "opacity-85 transition-opacity hover:opacity-100"
        ),
        key: segment.key,
        style: { width: `${pct}%` },
        title: `${segment.label}: ${segment.value.toLocaleString()} (${pct.toFixed(1)}%)`
      }
    );
  })), /* @__PURE__ */ React.createElement("div", { className: "grid gap-2 sm:grid-cols-2 xl:grid-cols-4" }, segments.map((segment) => {
    const pct = total > 0 ? segment.value / total * 100 : 0;
    return /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2", key: segment.key }, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cn(
          "block size-2 rounded-full",
          segment.colorClassName
        )
      }
    ), /* @__PURE__ */ React.createElement("span", { className: "text-[11px] text-muted-foreground" }, segment.label), /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cn(
          "ml-auto font-mono text-xs",
          segment.textClassName
        )
      },
      segment.value.toLocaleString(),
      pct > 0 ? /* @__PURE__ */ React.createElement("span", { className: "ml-1 text-[10px] text-muted-foreground" }, pct >= 1 ? Math.round(pct) : pct.toFixed(1), "%") : null
    ));
  })));
}
export {
  SegmentedBar
};
//# sourceMappingURL=segmented-bar.mjs.map