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
import {
  require_link
} from "../../chunk-D6PSM7AT.mjs";
import {
  Badge
} from "../../chunk-3I7NW6GS.mjs";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import "../../chunk-522NBUZJ.mjs";
import {
  __toESM
} from "../../chunk-LZOMFHX3.mjs";

// components/ui/user-usage-table.tsx
var import_link = __toESM(require_link());
import { UserIcon } from "lucide-react";
function UserUsageTable({
  rows,
  onToggleUser
}) {
  if (rows.length === 0) {
    return /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-8",
        description: "Adjust the selected filters to see user activity.",
        icon: UserIcon,
        title: "No user activity"
      }
    );
  }
  return /* @__PURE__ */ React.createElement(Table, null, /* @__PURE__ */ React.createElement(TableHeader, null, /* @__PURE__ */ React.createElement(TableRow, null, /* @__PURE__ */ React.createElement(TableHead, null, "User"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Sessions"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Input"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Output"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Cost"))), /* @__PURE__ */ React.createElement(TableBody, null, rows.map((row) => /* @__PURE__ */ React.createElement(TableRow, { key: row.id }, /* @__PURE__ */ React.createElement(TableCell, null, /* @__PURE__ */ React.createElement(
    Button,
    {
      className: "h-auto px-0 font-medium",
      onClick: () => onToggleUser?.(row.id),
      variant: "ghost"
    },
    row.label,
    row.active ? /* @__PURE__ */ React.createElement(Badge, { className: "ml-2", variant: "secondary" }, "Filtered") : null
  ), row.href ? /* @__PURE__ */ React.createElement(
    import_link.default,
    {
      className: "ml-2 text-muted-foreground text-xs underline underline-offset-2",
      href: row.href
    },
    "View sessions"
  ) : null), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.sessions), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.input), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.output), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.cost)))));
}
export {
  UserUsageTable
};
//# sourceMappingURL=user-usage-table.mjs.map