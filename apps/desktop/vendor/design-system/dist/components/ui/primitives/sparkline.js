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

// components/ui/primitives/sparkline.tsx
var sparkline_exports = {};
__export(sparkline_exports, {
  Sparkline: () => Sparkline
});
module.exports = __toCommonJS(sparkline_exports);
var import_react = require("react");
function Sparkline({
  values,
  width = 80,
  height = 20,
  className,
  stroke = "currentColor"
}) {
  const points = (0, import_react.useMemo)(() => {
    const clean = values.map(
      (value) => typeof value === "number" && Number.isFinite(value) ? value : null
    ).filter((value) => value !== null);
    if (clean.length < 2) {
      return null;
    }
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const range = max - min || 1;
    const step = width / (clean.length - 1);
    return clean.map((value, index) => {
      const x = index * step;
      const y = height - (value - min) / range * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }, [height, values, width]);
  if (!points) {
    return null;
  }
  return /* @__PURE__ */ React.createElement(
    "svg",
    {
      "aria-hidden": "true",
      className,
      height,
      viewBox: `0 0 ${width} ${height}`,
      width
    },
    /* @__PURE__ */ React.createElement(
      "polyline",
      {
        fill: "none",
        points,
        stroke,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: "1.5"
      }
    )
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Sparkline
});
//# sourceMappingURL=sparkline.js.map