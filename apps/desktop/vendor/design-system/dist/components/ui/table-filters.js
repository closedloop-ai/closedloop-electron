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

// components/ui/table-filters.ts
var table_filters_exports = {};
__export(table_filters_exports, {
  TABLE_DATE_PRESET_LABELS: () => TABLE_DATE_PRESET_LABELS,
  TableDateFilterField: () => TableDateFilterField,
  TableDatePreset: () => TableDatePreset
});
module.exports = __toCommonJS(table_filters_exports);
var TableDatePreset = {
  Last24h: "LAST_24H",
  Last7d: "LAST_7D",
  Last30d: "LAST_30D",
  Last3m: "LAST_3M",
  Custom: "CUSTOM"
};
var TABLE_DATE_PRESET_LABELS = {
  [TableDatePreset.Last24h]: "Last 24 hours",
  [TableDatePreset.Last7d]: "Last 7 days",
  [TableDatePreset.Last30d]: "Last 30 days",
  [TableDatePreset.Last3m]: "Last 3 months",
  [TableDatePreset.Custom]: "Custom range"
};
var TableDateFilterField = {
  CreatedAt: "CREATED_AT",
  UpdatedAt: "UPDATED_AT"
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TABLE_DATE_PRESET_LABELS,
  TableDateFilterField,
  TableDatePreset
});
//# sourceMappingURL=table-filters.js.map