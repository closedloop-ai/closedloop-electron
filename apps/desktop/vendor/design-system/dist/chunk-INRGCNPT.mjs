import React from "react";
import {
  AgentStatusBadge
} from "./chunk-FQSOQDF7.mjs";
import {
  formatDateTime
} from "./chunk-UGNO5UUO.mjs";
import {
  Button
} from "./chunk-TT7DUYOP.mjs";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/primitives/event-group-row.tsx
import { ChevronRight } from "lucide-react";
import { useState } from "react";
function EventGroupRow({
  group,
  defaultExpanded = false
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const first = group.events[0];
  const statuses = group.events.reduce((sequence, event) => {
    if (sequence[sequence.length - 1] !== event.status) {
      sequence.push(event.status);
    }
    return sequence;
  }, []);
  const isMultiEvent = group.events.length > 1;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm",
        isMultiEvent && "border-l-2 border-l-cyan-500/40"
      )
    },
    /* @__PURE__ */ React.createElement(
      "button",
      {
        className: cn(
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/35",
          isMultiEvent && "bg-cyan-500/[0.03] hover:bg-cyan-500/[0.06]"
        ),
        onClick: () => setExpanded((value) => !value),
        type: "button"
      },
      /* @__PURE__ */ React.createElement(
        ChevronRight,
        {
          className: cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )
        }
      ),
      /* @__PURE__ */ React.createElement("div", { className: "min-w-0 flex-1 space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement("p", { className: "truncate font-medium text-sm" }, group.title), first?.toolName ? /* @__PURE__ */ React.createElement("span", { className: "font-mono text-[11px] text-muted-foreground" }, first.toolName) : null, isMultiEvent ? /* @__PURE__ */ React.createElement("span", { className: "font-mono text-[11px] text-muted-foreground" }, group.events.length, " events") : null), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground" }, /* @__PURE__ */ React.createElement("span", null, formatDateTime(first.createdAt)), group.durationLabel ? /* @__PURE__ */ React.createElement("span", null, group.durationLabel) : null, first.agentLabel ? /* @__PURE__ */ React.createElement("span", null, first.agentLabel) : null, first.project ? /* @__PURE__ */ React.createElement("span", null, first.project) : null)),
      /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 flex-wrap items-center justify-end gap-1" }, statuses.map((status, index) => /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1", key: `${status}-${index}` }, index > 0 ? /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-muted-foreground" }, "\u2192") : null, /* @__PURE__ */ React.createElement(AgentStatusBadge, { status }))))
    ),
    expanded ? /* @__PURE__ */ React.createElement("div", { className: "border-border/70 border-t bg-muted/15 px-4 py-3" }, isMultiEvent ? /* @__PURE__ */ React.createElement("div", { className: "mb-3 font-medium text-[10px] text-muted-foreground uppercase tracking-[0.12em]" }, group.events.length, " grouped events") : null, /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, group.events.map((event) => /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "rounded-lg border border-border/70 bg-background/70 p-3",
        key: event.id
      },
      /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2" }, /* @__PURE__ */ React.createElement(AgentStatusBadge, { status: event.status }), /* @__PURE__ */ React.createElement("span", { className: "font-mono text-[11px] text-muted-foreground" }, event.eventType), /* @__PURE__ */ React.createElement("span", { className: "font-medium text-sm" }, event.title), /* @__PURE__ */ React.createElement("span", { className: "ml-auto text-[11px] text-muted-foreground" }, formatDateTime(event.createdAt))),
      event.summary ? /* @__PURE__ */ React.createElement("p", { className: "mt-2 text-muted-foreground text-sm" }, event.summary) : null,
      event.metadata?.length ? /* @__PURE__ */ React.createElement("div", { className: "mt-3 flex flex-wrap gap-2" }, event.metadata.map((item) => /* @__PURE__ */ React.createElement(
        Button,
        {
          className: "h-auto px-2 py-1 font-normal text-[11px]",
          key: `${event.id}-${item.label}`,
          variant: "outline"
        },
        /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground" }, item.label),
        /* @__PURE__ */ React.createElement("span", { className: "font-mono" }, item.value)
      ))) : null,
      event.detail ? /* @__PURE__ */ React.createElement(EventDetailPanel, { event }) : null
    )))) : null
  );
}
function EventDetailPanel({ event }) {
  const detail = event.detail;
  if (!detail) {
    return null;
  }
  return /* @__PURE__ */ React.createElement("div", { className: "mt-3 space-y-3 rounded-lg border border-border/70 bg-muted/10 p-3" }, detail.summary ? /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("p", { className: "font-medium text-sm" }, detail.summary.headline), detail.summary.bullets?.length ? /* @__PURE__ */ React.createElement("ul", { className: "list-disc space-y-1 pl-5 text-muted-foreground text-sm" }, detail.summary.bullets.map((bullet) => /* @__PURE__ */ React.createElement("li", { key: bullet }, bullet))) : null) : null, detail.fields.length ? /* @__PURE__ */ React.createElement("dl", { className: "grid gap-2 md:grid-cols-2" }, detail.fields.map((field) => /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "rounded-md border border-border/60 bg-background/80 p-2",
      key: `${event.id}-${field.key}`
    },
    /* @__PURE__ */ React.createElement("dt", { className: "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground" }, field.label),
    /* @__PURE__ */ React.createElement("dd", { className: "mt-1 break-words font-mono text-xs text-foreground" }, formatJsonValue(field.value))
  ))) : null);
}
function formatJsonValue(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

export {
  EventGroupRow
};
//# sourceMappingURL=chunk-INRGCNPT.mjs.map