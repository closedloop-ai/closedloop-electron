var React = require("react");
"use strict";
"use client";
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

// components/ui/primitives/key-value-grid.tsx
var key_value_grid_exports = {};
__export(key_value_grid_exports, {
  KeyValueGrid: () => KeyValueGrid
});
module.exports = __toCommonJS(key_value_grid_exports);
function renderValue(value) {
  if (value === null) {
    return /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground italic" }, "null");
  }
  if (typeof value === "boolean") {
    return /* @__PURE__ */ React.createElement("span", { className: "rounded border border-border bg-muted px-2 py-0.5 font-mono text-[11px]" }, value ? "true" : "false");
  }
  if (typeof value === "number") {
    return /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, value.toLocaleString());
  }
  if (typeof value === "string") {
    return /* @__PURE__ */ React.createElement("span", { className: "break-all font-mono text-foreground" }, value);
  }
  return /* @__PURE__ */ React.createElement("pre", { className: "overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground" }, JSON.stringify(value, null, 2));
}
function KeyValueGrid({
  data,
  priority = []
}) {
  const priorityEntries = priority.map((key) => [key, data[key]]).filter((entry) => entry[1] !== void 0);
  const restEntries = Object.entries(data).filter(
    ([key]) => !priority.includes(key)
  );
  const rows = [...priorityEntries, ...restEntries];
  if (rows.length === 0) {
    return /* @__PURE__ */ React.createElement("p", { className: "text-[11px] text-muted-foreground italic" }, "Empty");
  }
  return /* @__PURE__ */ React.createElement("div", { className: "overflow-hidden rounded-xl border border-border/70 bg-card/70" }, /* @__PURE__ */ React.createElement("table", { className: "w-full border-collapse text-[11px]" }, /* @__PURE__ */ React.createElement("tbody", null, rows.map(([key, value], index) => /* @__PURE__ */ React.createElement(
    "tr",
    {
      className: index > 0 ? "border-border/70 border-t" : void 0,
      key
    },
    /* @__PURE__ */ React.createElement("td", { className: "w-[28%] bg-muted/45 px-3 py-2 align-top font-mono text-muted-foreground" }, key),
    /* @__PURE__ */ React.createElement("td", { className: "px-3 py-2 align-top" }, renderValue(value))
  )))));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KeyValueGrid
});
//# sourceMappingURL=key-value-grid.js.map