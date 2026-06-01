import React from "react";
import {
  AgentStatusBadge
} from "./chunk-FQSOQDF7.mjs";
import {
  Badge
} from "./chunk-3I7NW6GS.mjs";
import {
  formatCurrency,
  formatDateTime,
  formatRelativeLabel
} from "./chunk-UGNO5UUO.mjs";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/primitives/agent-card.tsx
import { Bot, Clock3, Coins, Cpu, GitBranch, Wrench } from "lucide-react";
function AgentCard({
  agent,
  active = false,
  className
}) {
  const isMain = agent.type === "main";
  const isWaiting = agent.status === "waiting";
  const isWorking = agent.status === "working";
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "rounded-xl border bg-card p-3 shadow-sm transition-colors",
        isWaiting ? "border-l-2 border-l-warning" : isWorking ? "border-l-2 border-l-success" : "border-border/80",
        active && "border-primary/35 bg-primary/8 ring-1 ring-primary/20",
        !active && "hover:border-border",
        className
      )
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-start justify-between gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex min-w-0 items-start gap-3" }, /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
          isMain ? "bg-primary/12 text-primary" : "bg-violet-500/12 text-violet-400"
        )
      },
      isMain ? /* @__PURE__ */ React.createElement(Bot, { className: "size-4" }) : /* @__PURE__ */ React.createElement(GitBranch, { className: "size-4" })
    ), /* @__PURE__ */ React.createElement("div", { className: "min-w-0 space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement("p", { className: "truncate font-medium text-sm" }, agent.name), agent.subagentType ? /* @__PURE__ */ React.createElement(Badge, { className: "font-mono text-[10px]", variant: "outline" }, agent.subagentType) : null), agent.label ? /* @__PURE__ */ React.createElement("p", { className: "truncate text-muted-foreground text-xs" }, agent.label) : null)), /* @__PURE__ */ React.createElement(AgentStatusBadge, { status: agent.status })),
    agent.task ? /* @__PURE__ */ React.createElement("p", { className: "mt-3 line-clamp-2 text-muted-foreground text-xs leading-relaxed" }, agent.task) : null,
    /* @__PURE__ */ React.createElement("div", { className: "mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" }, agent.currentTool ? /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1" }, /* @__PURE__ */ React.createElement(Wrench, { className: "size-3" }), /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, agent.currentTool)) : null, agent.model ? /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1" }, /* @__PURE__ */ React.createElement(Cpu, { className: "size-3" }), agent.model) : null, typeof agent.cost === "number" && agent.cost > 0 ? /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1" }, /* @__PURE__ */ React.createElement(Coins, { className: "size-3" }), formatCurrency(agent.cost)) : null, /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1" }, /* @__PURE__ */ React.createElement(Clock3, { className: "size-3" }), formatRelativeLabel(
      agent.updatedAt || agent.endedAt || agent.startedAt
    ))),
    /* @__PURE__ */ React.createElement("div", { className: "mt-2 text-[11px] text-muted-foreground" }, "Started ", formatDateTime(agent.startedAt))
  );
}

export {
  AgentCard
};
//# sourceMappingURL=chunk-ZOZRDCSE.mjs.map