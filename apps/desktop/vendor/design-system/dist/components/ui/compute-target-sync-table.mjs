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
  Badge
} from "../../chunk-3I7NW6GS.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/compute-target-sync-table.tsx
import { HardDriveDownloadIcon } from "lucide-react";
function ComputeTargetSyncTable({
  rows
}) {
  if (rows.length === 0) {
    return /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-8",
        description: "Connect a compute target to start reporting sync data here.",
        icon: HardDriveDownloadIcon,
        title: "No compute targets yet"
      }
    );
  }
  return /* @__PURE__ */ React.createElement(Table, null, /* @__PURE__ */ React.createElement(TableHeader, null, /* @__PURE__ */ React.createElement(TableRow, null, /* @__PURE__ */ React.createElement(TableHead, null, "Compute Target"), /* @__PURE__ */ React.createElement(TableHead, null, "Owner"), /* @__PURE__ */ React.createElement(TableHead, null, "Status"), /* @__PURE__ */ React.createElement(TableHead, null, "Last Sync"), /* @__PURE__ */ React.createElement(TableHead, null, "Last Seen"))), /* @__PURE__ */ React.createElement(TableBody, null, rows.map((row) => /* @__PURE__ */ React.createElement(TableRow, { key: row.id }, /* @__PURE__ */ React.createElement(TableCell, { className: "font-medium" }, row.machineName), /* @__PURE__ */ React.createElement(TableCell, null, row.ownerLabel), /* @__PURE__ */ React.createElement(TableCell, null, /* @__PURE__ */ React.createElement(Badge, { variant: "secondary" }, row.online ? "online" : "offline")), /* @__PURE__ */ React.createElement(TableCell, null, row.lastSyncLabel), /* @__PURE__ */ React.createElement(TableCell, null, row.lastSeenLabel)))));
}
export {
  ComputeTargetSyncTable
};
//# sourceMappingURL=compute-target-sync-table.mjs.map