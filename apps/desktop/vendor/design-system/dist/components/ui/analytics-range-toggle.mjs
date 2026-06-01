import React from "react";
"use client";
import {
  ToggleGroup,
  ToggleGroupItem
} from "../../chunk-6NQCPXX4.mjs";
import "../../chunk-XS6N43AI.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/analytics-range-toggle.tsx
function AnalyticsRangeToggle({
  label = "Range",
  options,
  value,
  onValueChange,
  className
}) {
  return /* @__PURE__ */ React.createElement("div", { className: className ?? "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "mr-2 font-medium text-slate-400 text-xs uppercase tracking-wider" }, label), /* @__PURE__ */ React.createElement(
    ToggleGroup,
    {
      className: "gap-1",
      onValueChange: (nextValue) => {
        if (nextValue) {
          onValueChange?.(nextValue);
        }
      },
      size: "sm",
      type: "single",
      value,
      variant: "outline"
    },
    options.map((option) => /* @__PURE__ */ React.createElement(
      ToggleGroupItem,
      {
        className: "border-slate-700 bg-transparent text-slate-400 hover:text-white data-[state=on]:border-emerald-500/60 data-[state=on]:bg-emerald-600 data-[state=on]:text-white",
        key: option.value,
        value: option.value
      },
      option.label
    ))
  ));
}
export {
  AnalyticsRangeToggle
};
//# sourceMappingURL=analytics-range-toggle.mjs.map