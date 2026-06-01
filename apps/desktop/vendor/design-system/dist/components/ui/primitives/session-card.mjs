import React from "react";
"use client";
import {
  HarnessBadge,
  SessionStatusBadge
} from "../../../chunk-FQSOQDF7.mjs";
import {
  Chip
} from "../../../chunk-TX5PRGT7.mjs";
import "../../../chunk-3I7NW6GS.mjs";
import {
  formatCurrency,
  formatRelativeLabel,
  truncateMiddle
} from "../../../chunk-UGNO5UUO.mjs";
import {
  cn
} from "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/primitives/session-card.tsx
import { Bot, Clock3, Coins, Cpu, FolderOpen, PlayCircle } from "lucide-react";
function SessionCard({
  session,
  active = false,
  className,
  onClick
}) {
  const Comp = onClick ? "button" : "div";
  const isWaiting = session.status === "waiting" || !!session.awaitingInputSince;
  const isActive = session.status === "active";
  return /* @__PURE__ */ React.createElement(
    Comp,
    {
      className: cn(
        "block w-full rounded-xl border bg-card p-3 text-left shadow-sm transition-colors",
        isWaiting ? "border-l-2 border-l-warning" : isActive ? "border-l-2 border-l-success" : "border-border/80",
        active && "bg-primary/8 ring-1 ring-primary/20",
        !onClick && "hover:border-border",
        className
      ),
      onClick,
      type: onClick ? "button" : void 0
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-start justify-between gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex min-w-0 items-start gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary" }, /* @__PURE__ */ React.createElement(FolderOpen, { className: "size-4" })), /* @__PURE__ */ React.createElement("div", { className: "min-w-0 space-y-1" }, /* @__PURE__ */ React.createElement("p", { className: "truncate font-medium text-sm" }, session.name), /* @__PURE__ */ React.createElement("p", { className: "truncate font-mono text-[11px] text-muted-foreground" }, session.id))), /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 items-center gap-1.5" }, /* @__PURE__ */ React.createElement(HarnessBadge, { harness: session.harness }), /* @__PURE__ */ React.createElement(SessionStatusBadge, { status: session.status }))),
    /* @__PURE__ */ React.createElement("p", { className: "mt-3 truncate font-mono text-[11px] text-muted-foreground" }, truncateMiddle(session.repo, 56)),
    /* @__PURE__ */ React.createElement("div", { className: "mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" }, /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1" }, /* @__PURE__ */ React.createElement(Bot, { className: "size-3" }), session.agents, " agents"), /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1" }, /* @__PURE__ */ React.createElement(Cpu, { className: "size-3" }), session.model), session.cost > 0 ? /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1" }, /* @__PURE__ */ React.createElement(Coins, { className: "size-3" }), formatCurrency(session.cost)) : null, session.durationLabel ? /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1" }, /* @__PURE__ */ React.createElement(Clock3, { className: "size-3" }), session.durationLabel) : null),
    /* @__PURE__ */ React.createElement("div", { className: "mt-3 flex items-center justify-between gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-[11px] text-muted-foreground" }, formatRelativeLabel(session.lastActivity)), session.isRunDriven ? /* @__PURE__ */ React.createElement(Chip, { size: "sm", variant: "accent" }, /* @__PURE__ */ React.createElement(PlayCircle, { className: "size-3" }), "Run-backed") : null)
  );
}
export {
  SessionCard
};
//# sourceMappingURL=session-card.mjs.map