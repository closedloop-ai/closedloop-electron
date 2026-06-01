import { useState } from "react";
import { AnalyticsView } from "../analytics/AnalyticsView";
import { WorkflowsView } from "../workflows/WorkflowsView";

type AgentsTab = "analytics" | "orchestration";

export function AgentsPage() {
  const [tab, setTab] = useState<AgentsTab>("analytics");

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 border-b px-6 pt-4 shrink-0">
        <button
          type="button"
          onClick={() => setTab("analytics")}
          className={`px-3 py-2 text-sm border-b-2 transition-colors ${
            tab === "analytics"
              ? "border-[var(--primary)] text-[var(--foreground)] font-medium"
              : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          }`}
        >
          Analytics
        </button>
        <button
          type="button"
          onClick={() => setTab("orchestration")}
          className={`px-3 py-2 text-sm border-b-2 transition-colors ${
            tab === "orchestration"
              ? "border-[var(--primary)] text-[var(--foreground)] font-medium"
              : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          }`}
        >
          Orchestration
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {tab === "analytics" ? <AnalyticsView /> : <WorkflowsView />}
      </div>
    </div>
  );
}
