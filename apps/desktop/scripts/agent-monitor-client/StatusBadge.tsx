/**
 * @file StatusBadge.tsx
 * @description Defines reusable React components for displaying the status of
 * agents and sessions in a visually distinct way using badges.
 */
import { useTranslation } from "react-i18next";
import { STATUS_CONFIG, SESSION_STATUS_CONFIG } from "../lib/types";
import type { EffectiveAgentStatus, EffectiveSessionStatus } from "../lib/types";

interface AgentStatusBadgeProps {
  status: EffectiveAgentStatus;
  pulse?: boolean;
}

export function AgentStatusBadge({ status, pulse }: AgentStatusBadgeProps) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status];
  const shouldPulse = pulse ?? (status === "working" || status === "waiting");

  return (
    <span className={`badge ${config.bg} ${config.color}`}>
      <span
        className={`w-1.5 h-1.5 rounded-full ${config.dot} ${
          shouldPulse ? "animate-pulse-dot" : ""
        }`}
      />
      {t(config.labelKey)}
    </span>
  );
}

interface SessionStatusBadgeProps {
  status: EffectiveSessionStatus;
  pulse?: boolean;
}

export function SessionStatusBadge({ status, pulse }: SessionStatusBadgeProps) {
  const { t } = useTranslation();
  const config = SESSION_STATUS_CONFIG[status];
  const shouldPulse = pulse ?? status === "waiting";
  return (
    <span className={`badge ${config.bg} ${config.color}`}>
      {shouldPulse && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${config.dot} animate-pulse-dot`}
          aria-hidden="true"
        />
      )}
      {t(config.labelKey)}
    </span>
  );
}

export function HarnessBadge({ harness }: { harness?: string | null }) {
  const h = (harness || "claude").toLowerCase();
  const config: Record<string, { label: string; cls: string }> = {
    codex: {
      label: "Codex",
      cls: "bg-sky-500/10 text-sky-300 border border-sky-500/20",
    },
    cursor: {
      label: "Cursor",
      cls: "bg-amber-500/10 text-amber-300 border border-amber-500/20",
    },
    copilot: {
      label: "Copilot",
      cls: "bg-green-500/10 text-green-300 border border-green-500/20",
    },
    opencode: {
      label: "OpenCode",
      cls: "bg-rose-500/10 text-rose-300 border border-rose-500/20",
    },
  };
  const { label, cls } = config[h] || {
    label: "Claude",
    cls: "bg-violet-500/10 text-violet-300 border border-violet-500/20",
  };
  return <span className={`badge ${cls}`}>{label}</span>;
}
