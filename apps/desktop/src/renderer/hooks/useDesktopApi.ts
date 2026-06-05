import { useCallback, useEffect, useState } from "react";

interface DesktopEventMap {
  "desktop:navigate-tab": CustomEvent<string>;
  "desktop:navigate-settings-tab": CustomEvent<string>;
  "desktop:command-keys-changed": CustomEvent;
  "desktop:update-available": CustomEvent<unknown>;
  "desktop:update-status": CustomEvent<unknown>;
  "desktop:onboarding-state-changed": CustomEvent;
  "desktop:show-onboarding-popup": CustomEvent;
}

export function useDesktopEvent<K extends keyof DesktopEventMap>(
  event: K,
  handler: (detail: DesktopEventMap[K]["detail"]) => void,
): void {
  useEffect(() => {
    const listener = (e: Event) => {
      handler((e as DesktopEventMap[K]).detail);
    };
    window.addEventListener(event, listener);
    return () => window.removeEventListener(event, listener);
  }, [event, handler]);
}

export function useCurrentTab(): [string, (tab: string) => void] {
  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.hash.slice(1));
      return params.get("tab") || "claude-dashboard";
    }
    return "claude-dashboard";
  });

  const navigate = useCallback((newTab: string) => {
    window.location.hash = `tab=${newTab}`;
    setTab(newTab);
  }, []);

  useDesktopEvent("desktop:navigate-tab", useCallback((detail) => {
    setTab(detail);
  }, []));

  return [tab, navigate];
}
