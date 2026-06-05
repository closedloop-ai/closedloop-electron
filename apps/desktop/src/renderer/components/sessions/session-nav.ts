import { createContext, useContext } from "react";

/**
 * Minimal drill-down navigation for the session list. The renderer has no
 * router (FEA-1497 Phase 1 decision: nav-stack over react-router); App owns a
 * single-depth stack and exposes `openSession` through this context so the
 * deeply-nested SessionTable rows can push the detail view.
 */
export interface SessionNav {
  openSession: (sessionId: string) => void;
}

export const SessionNavContext = createContext<SessionNav | null>(null);

export function useSessionNav(): SessionNav {
  return useContext(SessionNavContext) ?? { openSession: () => {} };
}
