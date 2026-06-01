import React from "react";
import {
  Badge
} from "./chunk-3I7NW6GS.mjs";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/primitives/status-badge.tsx
var sessionStatusConfig = {
  active: { label: "Active", tone: "success", pulse: true },
  waiting: { label: "Waiting", tone: "accent", pulse: true },
  completed: { label: "Completed", tone: "muted" },
  error: { label: "Error", tone: "danger" },
  abandoned: { label: "Abandoned", tone: "warning" }
};
var agentStatusConfig = {
  working: { label: "Working", tone: "success", pulse: true },
  waiting: { label: "Waiting", tone: "accent", pulse: true },
  completed: { label: "Completed", tone: "muted" },
  error: { label: "Error", tone: "danger" },
  idle: { label: "Idle", tone: "default" }
};
var toneClasses = {
  default: "border-input-border bg-input text-foreground",
  success: "border-success/25 bg-success/12 text-success",
  warning: "border-warning/30 bg-warning/14 text-warning-foreground",
  danger: "border-destructive/25 bg-destructive/12 text-destructive",
  info: "border-info/25 bg-info/12 text-info",
  accent: "border-primary/20 bg-primary/10 text-primary",
  muted: "border-border bg-muted/70 text-muted-foreground"
};
var harnessConfig = {
  claude: { label: "Claude", tone: "accent" },
  codex: { label: "Codex", tone: "info" },
  cursor: { label: "Cursor", tone: "warning" },
  copilot: { label: "Copilot", tone: "success" },
  opencode: { label: "OpenCode", tone: "danger" }
};
function resolveSessionStatusConfig(status) {
  if (status in sessionStatusConfig) {
    return sessionStatusConfig[status];
  }
  if (status === "failed") {
    return { label: "Failed", tone: "danger" };
  }
  return {
    label: status.replace(/[-_]/g, " "),
    tone: "danger"
  };
}
function resolveAgentStatusConfig(status) {
  if (status in agentStatusConfig) {
    return agentStatusConfig[status];
  }
  if (status === "failed") {
    return { label: "Failed", tone: "danger" };
  }
  return {
    label: status.replace(/[-_]/g, " "),
    tone: "danger"
  };
}
function ToneBadge({
  label,
  tone = "default",
  pulse = false,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    Badge,
    {
      className: cn(
        "h-6 gap-1.5 rounded-full px-2.5 font-semibold text-[11px] tracking-[0.01em]",
        toneClasses[tone],
        className
      ),
      variant: "outline"
    },
    /* @__PURE__ */ React.createElement(
      "span",
      {
        "aria-hidden": "true",
        className: cn(
          "size-1.5 rounded-full bg-current",
          pulse && "animate-[pulse_1.6s_ease-in-out_infinite]"
        )
      }
    ),
    label
  );
}
function SessionStatusBadge({
  status
}) {
  const config = resolveSessionStatusConfig(status);
  return /* @__PURE__ */ React.createElement(
    ToneBadge,
    {
      label: config.label,
      pulse: config.pulse,
      tone: config.tone
    }
  );
}
function AgentStatusBadge({
  status
}) {
  const config = resolveAgentStatusConfig(status);
  return /* @__PURE__ */ React.createElement(
    ToneBadge,
    {
      label: config.label,
      pulse: config.pulse,
      tone: config.tone
    }
  );
}
function HarnessBadge({
  harness
}) {
  const config = harnessConfig[(harness || "claude").toLowerCase()] || {
    label: harness || "Claude",
    tone: "accent"
  };
  return /* @__PURE__ */ React.createElement(ToneBadge, { label: config.label, tone: config.tone });
}

export {
  ToneBadge,
  SessionStatusBadge,
  AgentStatusBadge,
  HarnessBadge
};
//# sourceMappingURL=chunk-FQSOQDF7.mjs.map