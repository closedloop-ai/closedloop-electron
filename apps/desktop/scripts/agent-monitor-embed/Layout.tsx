/**
 * @file Layout.tsx
 * @description ClosedLoop-authored replacement for the upstream agent-monitor
 * Layout. Copied verbatim over `src/components/Layout.tsx` at build time by
 * scripts/build-agent-monitor.mjs.
 *
 * The agent monitor ships embedded as an <iframe> inside the ClosedLoop
 * Desktop app, which renders its own left sidebar + topbar. In embed mode
 * (the iframe src carries `?embed=1`) this Layout therefore:
 *   - drops the monitor's own <Sidebar> so there is no "app within an app";
 *   - accepts navigation from the host over postMessage, so the host sidebar
 *     drives the monitor's routes without an iframe reload.
 *
 * When opened directly (no `?embed=1`) it behaves exactly like upstream.
 */

import { useState, useCallback, useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar, SIDEBAR_STORAGE_KEY, loadCollapsed } from "./Sidebar";
import { UpdateNotifier } from "./UpdateNotifier";

interface LayoutProps {
  wsConnected: boolean;
}

const EMBED_HOST_ORIGIN_QUERY_PARAM = "closedloop_host_origin";
const EMBED_HOST_ORIGIN_STORAGE_KEY = "closedloop.embed-host-origin";

// The monitor is only ever framed by the ClosedLoop desktop app, so being in
// an iframe IS embed mode. This beats reading `?embed=1` from the URL: React
// Router navigations drop the query string, and the host can drive routes
// after the initial load.
function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access threw — we are inside a frame.
    return true;
  }
}

function resolveAllowedHostOrigin(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get(EMBED_HOST_ORIGIN_QUERY_PARAM);
    if (fromQuery) {
      window.sessionStorage.setItem(EMBED_HOST_ORIGIN_STORAGE_KEY, fromQuery);
      return fromQuery;
    }
    return window.sessionStorage.getItem(EMBED_HOST_ORIGIN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function Layout({ wsConnected }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const navigate = useNavigate();
  const embedded = isEmbedded();
  const allowedHostOrigin = resolveAllowedHostOrigin();

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        /* localStorage unavailable */
      }
      return next;
    });
  }, []);

  // Host → iframe navigation bridge. The desktop sidebar posts
  // { type: "closedloop:navigate", path } and we route to it in-place.
  useEffect(() => {
    if (!embedded) {
      return;
    }
    const onMessage = (event: MessageEvent): void => {
      // MessageEvent.data is `any`; guard the shape before routing.
      const data = event.data;
      if (
        event.origin === allowedHostOrigin &&
        data &&
        typeof data === "object" &&
        data.type === "closedloop:navigate" &&
        typeof data.path === "string"
      ) {
        navigate(data.path);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [allowedHostOrigin, embedded, navigate]);

  if (embedded) {
    return (
      <div className="min-h-screen bg-surface-0">
        <UpdateNotifier />
        <main className="min-h-screen min-w-0">
          <div className="p-5 lg:p-6 max-w-full overflow-x-hidden">
            <Outlet />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-0">
      <UpdateNotifier />
      <Sidebar wsConnected={wsConnected} collapsed={collapsed} onToggle={toggle} />
      <main
        className="min-h-screen min-w-0 transition-[margin-left,width] duration-200"
        style={{
          marginLeft: collapsed ? "4.25rem" : "15rem",
          width: collapsed ? "calc(100% - 4.25rem)" : "calc(100% - 15rem)",
        }}
      >
        <div className="p-5 lg:p-6 max-w-full overflow-x-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
