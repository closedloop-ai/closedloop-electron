import React from "react";
import {
  EventGroupRow
} from "../../chunk-INRGCNPT.mjs";
import {
  AgentCard
} from "../../chunk-ZOZRDCSE.mjs";
import {
  Section
} from "../../chunk-ZF7NKEIL.mjs";
import "../../chunk-FQSOQDF7.mjs";
import {
  MetricCard
} from "../../chunk-WEVGGIH7.mjs";
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
  Chip
} from "../../chunk-TX5PRGT7.mjs";
import "../../chunk-3I7NW6GS.mjs";
import "../../chunk-ZKMGHYX7.mjs";
import "../../chunk-UGNO5UUO.mjs";
import "../../chunk-TT7DUYOP.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/session-detail-panels.tsx
import {
  AlertCircleIcon,
  BotIcon,
  Clock3Icon,
  FolderGit2Icon,
  HistoryIcon,
  TerminalSquareIcon,
  WrenchIcon
} from "lucide-react";
function SessionSummaryMetrics({
  metrics
}) {
  return /* @__PURE__ */ React.createElement("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4" }, metrics.map((metric) => /* @__PURE__ */ React.createElement(
    MetricCard,
    {
      detail: metric.detail,
      key: metric.label,
      label: metric.label,
      value: metric.value
    }
  )));
}
function SessionMetadataPanel({
  metadata,
  details = []
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-3 text-sm",
      title: "Session metadata",
      description: "Identity, ownership, and source metadata for the synced session."
    },
    /* @__PURE__ */ React.createElement("div", { className: "grid gap-3 md:grid-cols-2" }, metadata.map((item) => /* @__PURE__ */ React.createElement("div", { key: item.label }, /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground" }, item.label), /* @__PURE__ */ React.createElement("div", { className: "font-medium" }, item.value)))),
    details.length > 0 ? /* @__PURE__ */ React.createElement("div", { className: "space-y-2 border-t pt-3" }, details.map((item) => /* @__PURE__ */ React.createElement("div", { key: item.label }, /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground" }, item.label, ":"), " ", item.value))) : null
  );
}
function SessionAttributionPanel({
  value
}) {
  return /* @__PURE__ */ React.createElement(
    JsonPanel,
    {
      description: "Structured attribution received from the local desktop sync.",
      emptyMessage: "No attribution data was captured for this session.",
      title: "Attribution",
      value
    }
  );
}
function SessionModelUsageTable({
  rows
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-0",
      title: "Token usage by model",
      description: "Input, output, cache, and cost totals grouped by model."
    },
    rows.length === 0 ? /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-10",
        description: "No model usage rows were recorded for this session.",
        icon: BotIcon,
        title: "No model usage"
      }
    ) : /* @__PURE__ */ React.createElement(Table, null, /* @__PURE__ */ React.createElement(TableHeader, null, /* @__PURE__ */ React.createElement(TableRow, null, /* @__PURE__ */ React.createElement(TableHead, null, "Model"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Input"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Output"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Cache Read"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Cache Write"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Cost"))), /* @__PURE__ */ React.createElement(TableBody, null, rows.map((row) => /* @__PURE__ */ React.createElement(TableRow, { key: row.model }, /* @__PURE__ */ React.createElement(TableCell, { className: "font-medium" }, row.model), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.inputTokens), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.outputTokens), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.cacheReadTokens), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.cacheWriteTokens), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.estimatedCost)))))
  );
}
function SessionToolInvocationsPanel({
  rows
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-0",
      description: "Distinct tools invoked during the session, grouped with counts and timing.",
      title: "Tool invocations"
    },
    rows.length === 0 ? /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-10",
        description: "No tool invocations were captured for this session.",
        icon: WrenchIcon,
        title: "No tool activity"
      }
    ) : /* @__PURE__ */ React.createElement(Table, null, /* @__PURE__ */ React.createElement(TableHeader, null, /* @__PURE__ */ React.createElement(TableRow, null, /* @__PURE__ */ React.createElement(TableHead, null, "Tool"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Count"), /* @__PURE__ */ React.createElement(TableHead, null, "First Seen"), /* @__PURE__ */ React.createElement(TableHead, null, "Last Seen"))), /* @__PURE__ */ React.createElement(TableBody, null, rows.map((row) => /* @__PURE__ */ React.createElement(TableRow, { key: row.toolName }, /* @__PURE__ */ React.createElement(TableCell, { className: "font-medium" }, row.toolName), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.count), /* @__PURE__ */ React.createElement(TableCell, null, row.firstSeenAt), /* @__PURE__ */ React.createElement(TableCell, null, row.lastSeenAt)))))
  );
}
function SessionErrorDetailsPanel({
  errors
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-4",
      description: "API and session events flagged as errors.",
      title: "Error details"
    },
    errors.length === 0 ? /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-10",
        description: "No error events were captured for this session.",
        icon: AlertCircleIcon,
        title: "No errors"
      }
    ) : errors.map((event) => /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "rounded-md border bg-muted/30 p-3",
        key: event.id
      },
      /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "font-medium" }, event.eventType), /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-xs" }, event.createdAt)),
      /* @__PURE__ */ React.createElement("div", { className: "mt-2 text-sm" }, event.summary),
      event.rawData ? /* @__PURE__ */ React.createElement("pre", { className: "mt-3 overflow-auto rounded-md bg-background p-2 text-xs" }, event.rawData) : null
    ))
  );
}
function SessionAgentsSection({
  agents,
  activeAgentId
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "p-0",
      description: "Agent rows captured from the local desktop monitor.",
      title: "Agents"
    },
    agents.length === 0 ? /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-10",
        description: "No agent records were captured for this session.",
        icon: WrenchIcon,
        title: "No agents"
      }
    ) : /* @__PURE__ */ React.createElement("div", { className: "grid gap-3 px-6 pb-6 lg:grid-cols-2" }, agents.map((agent) => /* @__PURE__ */ React.createElement(
      AgentCard,
      {
        active: agent.id === activeAgentId,
        agent,
        key: agent.id
      }
    )))
  );
}
function SessionTimelineSection({
  facets,
  groups,
  activeFilters
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-0",
      title: "Event timeline",
      description: "Normalized event stream with shared filtering and grouped rows."
    },
    groups.length === 0 ? /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-10",
        description: "No events were captured for this session.",
        icon: HistoryIcon,
        title: "No events"
      }
    ) : /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-2 border-border/70 border-b px-6 pb-4 text-xs" }, /* @__PURE__ */ React.createElement(Chip, { variant: "muted" }, facets.statuses.length, " statuses"), /* @__PURE__ */ React.createElement(Chip, { variant: "muted" }, facets.eventTypes.length, " event types"), /* @__PURE__ */ React.createElement(Chip, { variant: "muted" }, facets.toolNames.length, " tools"), /* @__PURE__ */ React.createElement(Chip, { variant: "muted" }, facets.agents.length, " agents"), activeFilters?.query ? /* @__PURE__ */ React.createElement(Chip, { interactive: true, variant: "outline" }, "Search: ", activeFilters.query) : null, activeFilters?.statuses.map((status) => /* @__PURE__ */ React.createElement(Chip, { key: `status-${status}`, variant: "outline" }, status)), activeFilters?.eventTypes.map((eventType) => /* @__PURE__ */ React.createElement(Chip, { key: `event-${eventType}`, variant: "outline" }, eventType)), activeFilters?.toolNames.map((toolName) => /* @__PURE__ */ React.createElement(Chip, { key: `tool-${toolName}`, variant: "outline" }, toolName))), /* @__PURE__ */ React.createElement("div", { className: "space-y-3 px-6 pb-6" }, groups.map((group) => /* @__PURE__ */ React.createElement(EventGroupRow, { group, key: group.id }))))
  );
}
function SessionOverviewSection({
  stats
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-0",
      title: "Session overview",
      description: "Shared session analytics built from events, tools, subagents, and token flow."
    },
    /* @__PURE__ */ React.createElement("div", { className: "space-y-6" }, /* @__PURE__ */ React.createElement("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-3" }, /* @__PURE__ */ React.createElement(
      MetricCard,
      {
        detail: stats.eventRateHint,
        icon: HistoryIcon,
        label: "Events",
        value: stats.totalEvents.toLocaleString()
      }
    ), /* @__PURE__ */ React.createElement(
      MetricCard,
      {
        icon: WrenchIcon,
        label: "Tool calls",
        value: stats.toolCalls.toLocaleString()
      }
    ), /* @__PURE__ */ React.createElement(
      MetricCard,
      {
        icon: BotIcon,
        label: "Subagents",
        value: stats.subagents.toLocaleString()
      }
    ), /* @__PURE__ */ React.createElement(
      MetricCard,
      {
        icon: Clock3Icon,
        label: "Compactions",
        value: stats.compactions.toLocaleString()
      }
    ), /* @__PURE__ */ React.createElement(
      MetricCard,
      {
        icon: AlertCircleIcon,
        label: "Errors",
        value: stats.errors.toLocaleString()
      }
    ), /* @__PURE__ */ React.createElement(
      MetricCard,
      {
        icon: FolderGit2Icon,
        label: "Duration",
        value: stats.durationLabel
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "grid gap-4 lg:grid-cols-3" }, /* @__PURE__ */ React.createElement("div", { className: "rounded-xl border border-border/80 bg-muted/10 p-4" }, /* @__PURE__ */ React.createElement("h4", { className: "font-medium text-sm" }, "Top tools"), /* @__PURE__ */ React.createElement("div", { className: "mt-3 space-y-2" }, stats.topTools.length ? stats.topTools.map((tool) => /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2",
        key: tool.toolName
      },
      /* @__PURE__ */ React.createElement("span", { className: "font-mono text-sm" }, tool.toolName),
      /* @__PURE__ */ React.createElement(Chip, { variant: "muted" }, tool.count)
    )) : /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, "No tool activity."))), /* @__PURE__ */ React.createElement("div", { className: "rounded-xl border border-border/80 bg-muted/10 p-4" }, /* @__PURE__ */ React.createElement("h4", { className: "font-medium text-sm" }, "Subagent types"), /* @__PURE__ */ React.createElement("div", { className: "mt-3 flex flex-wrap gap-2" }, stats.subagentTypes.length ? stats.subagentTypes.map((entry) => /* @__PURE__ */ React.createElement(
      Chip,
      {
        key: entry.label,
        variant: entry.isCompaction ? "warning" : "outline"
      },
      entry.label,
      " ",
      entry.count
    )) : /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, "No subagent activity."))), /* @__PURE__ */ React.createElement("div", { className: "rounded-xl border border-border/80 bg-muted/10 p-4" }, /* @__PURE__ */ React.createElement("h4", { className: "font-medium text-sm" }, "Token mix"), /* @__PURE__ */ React.createElement("div", { className: "mt-3 space-y-2 text-sm" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("span", null, "Input"), /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, stats.tokens.inputTokens.toLocaleString())), /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("span", null, "Output"), /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, stats.tokens.outputTokens.toLocaleString())), /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("span", null, "Cache read"), /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, stats.tokens.cacheReadTokens.toLocaleString())), /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("span", null, "Cache write"), /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, stats.tokens.cacheWriteTokens.toLocaleString()))))), stats.activeAgent ? /* @__PURE__ */ React.createElement("div", { className: "rounded-xl border border-border/80 bg-muted/10 p-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement("h4", { className: "font-medium text-sm" }, "Active agent"), /* @__PURE__ */ React.createElement(Chip, { variant: "outline" }, stats.activeAgent.name), stats.activeAgent.currentTool ? /* @__PURE__ */ React.createElement(Chip, { variant: "muted" }, stats.activeAgent.currentTool) : null), stats.activeAgent.task ? /* @__PURE__ */ React.createElement("p", { className: "mt-3 text-muted-foreground text-sm" }, stats.activeAgent.task) : null) : null)
  );
}
function JsonPanel({
  title,
  description,
  value,
  emptyMessage = "No structured data is available."
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-0",
      description,
      title
    },
    value ? /* @__PURE__ */ React.createElement("pre", { className: "overflow-auto rounded-md bg-muted p-3 text-xs" }, value) : /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-10",
        description: emptyMessage,
        icon: TerminalSquareIcon,
        title: `No ${title.toLowerCase()}`
      }
    )
  );
}
export {
  JsonPanel,
  SessionAgentsSection,
  SessionAttributionPanel,
  SessionErrorDetailsPanel,
  SessionMetadataPanel,
  SessionModelUsageTable,
  SessionOverviewSection,
  SessionSummaryMetrics,
  SessionTimelineSection,
  SessionToolInvocationsPanel
};
//# sourceMappingURL=session-detail-panels.mjs.map