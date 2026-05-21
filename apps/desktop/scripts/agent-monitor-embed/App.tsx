/**
 * @file App.tsx
 * @description ClosedLoop-authored replacement for the upstream agent-monitor
 * App router. Copied verbatim over `src/App.tsx` at build time by
 * scripts/build-agent-monitor.mjs.
 *
 * This keeps our route contract explicit in-repo: we layer host-owned
 * additions such as the gated Plans page on top of the pinned upstream base
 * instead of editing the dependency in place.
 */

import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useCallback } from "react";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { KanbanBoard } from "./pages/KanbanBoard";
import { Sessions } from "./pages/Sessions";
import { SessionDetail } from "./pages/SessionDetail";
import { ActivityFeed } from "./pages/ActivityFeed";
import { Analytics } from "./pages/Analytics";
import { Workflows } from "./pages/Workflows";
import { Settings } from "./pages/Settings";
import { CcConfig } from "./pages/CcConfig";
import { Run } from "./pages/Run";
import { Plans } from "./pages/Plans";
import { Packs } from "./pages/Packs";
import { PackDetail } from "./pages/PackDetail";
import { NotFound } from "./pages/NotFound";
import { isPlanExtractionEnabled } from "./lib/closedloop-host-flags";
import { useWebSocket } from "./hooks/useWebSocket";
import { useNotifications } from "./hooks/useNotifications";
import { eventBus } from "./lib/eventBus";
import type { WSMessage } from "./lib/types";

export default function App() {
  const onMessage = useCallback((msg: WSMessage) => {
    eventBus.publish(msg);
  }, []);

  const { connected } = useWebSocket(onMessage);
  useNotifications();

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout wsConnected={connected} />}>
          <Route index element={<Dashboard />} />
          <Route path="kanban" element={<KanbanBoard />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="sessions/:id" element={<SessionDetail />} />
          <Route path="activity" element={<ActivityFeed />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="workflows" element={<Workflows />} />
          <Route path="cc-config" element={<CcConfig />} />
          <Route path="run" element={<Run />} />
          <Route path="plans" element={isPlanExtractionEnabled() ? <Plans /> : <NotFound />} />
          <Route path="packs" element={<Packs />} />
          <Route path="packs/:packId" element={<PackDetail />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
