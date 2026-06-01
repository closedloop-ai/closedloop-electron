import React from "react";
import {
  HarnessBadge,
  SessionStatusBadge,
  ToneBadge
} from "../../../chunk-FQSOQDF7.mjs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../chunk-PWY5AK4F.mjs";
import {
  Chip
} from "../../../chunk-TX5PRGT7.mjs";
import "../../../chunk-3I7NW6GS.mjs";
import {
  formatCurrency,
  formatDateTime,
  formatRelativeLabel,
  formatTokenCount,
  truncateMiddle
} from "../../../chunk-UGNO5UUO.mjs";
import "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/composites/session-table.tsx
import { Play } from "lucide-react";
function SessionTable({
  rows,
  emptyState,
  getSessionHref,
  renderSessionLink,
  extraColumnLabel,
  renderExtraColumn
}) {
  if (rows.length === 0) {
    return emptyState ?? /* @__PURE__ */ React.createElement("div", { className: "px-6 py-12 text-center text-muted-foreground text-sm" }, "No sessions match the current filters.");
  }
  return /* @__PURE__ */ React.createElement(Table, null, /* @__PURE__ */ React.createElement(TableHeader, { className: "bg-muted/30" }, /* @__PURE__ */ React.createElement(TableRow, null, /* @__PURE__ */ React.createElement(TableHead, null, "Session"), /* @__PURE__ */ React.createElement(TableHead, null, "Status"), /* @__PURE__ */ React.createElement(TableHead, null, "Last activity"), /* @__PURE__ */ React.createElement(TableHead, null, "Duration"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Tokens"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Agents"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Cost"), /* @__PURE__ */ React.createElement(TableHead, null, "Directory"), extraColumnLabel ? /* @__PURE__ */ React.createElement(TableHead, null, extraColumnLabel) : null)), /* @__PURE__ */ React.createElement(TableBody, null, rows.map((row) => {
    const href = getSessionHref?.(row);
    return /* @__PURE__ */ React.createElement(TableRow, { key: row.id }, /* @__PURE__ */ React.createElement(TableCell, { className: "align-top" }, /* @__PURE__ */ React.createElement("div", { className: "flex min-w-[14rem] flex-col gap-2" }, /* @__PURE__ */ React.createElement("div", { className: "font-medium" }, renderSessionLink ? renderSessionLink(row) : href ? /* @__PURE__ */ React.createElement("a", { className: "hover:underline", href }, row.name) : row.name), /* @__PURE__ */ React.createElement("div", { className: "font-mono text-[11px] text-muted-foreground" }, row.id.slice(0, 12)), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-2" }, /* @__PURE__ */ React.createElement(HarnessBadge, { harness: row.harness }), /* @__PURE__ */ React.createElement(Chip, { variant: "outline" }, row.model), row.isRunDriven ? /* @__PURE__ */ React.createElement(Chip, { asChild: true, interactive: true, variant: "success" }, /* @__PURE__ */ React.createElement("a", { href: row.runHref || "#" }, /* @__PURE__ */ React.createElement(Play, { className: "size-3" }), "Run")) : null, row.awaitingInputSince ? /* @__PURE__ */ React.createElement(
      ToneBadge,
      {
        label: "Awaiting input",
        pulse: true,
        tone: "accent"
      }
    ) : null))), /* @__PURE__ */ React.createElement(TableCell, { className: "align-top" }, /* @__PURE__ */ React.createElement(SessionStatusBadge, { status: row.status })), /* @__PURE__ */ React.createElement(TableCell, { className: "align-top" }, /* @__PURE__ */ React.createElement("div", { className: "text-sm" }, formatRelativeLabel(row.lastActivity)), /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-xs" }, formatDateTime(row.lastActivity))), /* @__PURE__ */ React.createElement(TableCell, { className: "align-top font-mono text-xs" }, row.durationLabel || "Running"), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right align-top tabular-nums" }, row.totalTokens == null ? "\u2014" : formatTokenCount(row.totalTokens)), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right align-top tabular-nums" }, row.agents), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right align-top tabular-nums" }, formatCurrency(row.cost)), /* @__PURE__ */ React.createElement(TableCell, { className: "align-top" }, /* @__PURE__ */ React.createElement("div", { className: "font-medium text-sm" }, truncateMiddle(row.repo, 36)), /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-xs" }, "Started ", formatDateTime(row.startedAt))), extraColumnLabel ? /* @__PURE__ */ React.createElement(TableCell, { className: "align-top" }, renderExtraColumn?.(row) ?? null) : null);
  })));
}
export {
  SessionTable
};
//# sourceMappingURL=session-table.mjs.map