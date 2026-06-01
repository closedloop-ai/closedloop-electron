import React from "react";
"use client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../chunk-PWY5AK4F.mjs";
import {
  EmptyState
} from "../../chunk-5O7DGJTJ.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/model-usage-table.tsx
import { Activity } from "lucide-react";
function ModelUsageTable({ rows }) {
  if (rows.length === 0) {
    return /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-8",
        description: "Adjust the selected filters to see model usage.",
        icon: Activity,
        title: "No model usage"
      }
    );
  }
  return /* @__PURE__ */ React.createElement(Table, null, /* @__PURE__ */ React.createElement(TableHeader, null, /* @__PURE__ */ React.createElement(TableRow, null, /* @__PURE__ */ React.createElement(TableHead, null, "Model"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Sessions"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Input"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Output"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Cache"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Cost"))), /* @__PURE__ */ React.createElement(TableBody, null, rows.map((row) => /* @__PURE__ */ React.createElement(TableRow, { key: row.model }, /* @__PURE__ */ React.createElement(TableCell, { className: "font-medium" }, row.model), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.sessions), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.input), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.output), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.cache), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.cost)))));
}
export {
  ModelUsageTable
};
//# sourceMappingURL=model-usage-table.mjs.map