import { useCallback, useState } from "react";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { useDesktopEvent } from "../hooks/useDesktopApi";
import {
  INITIAL_UPDATE_BANNER_STATE,
  isUpdateApplyEnabled,
  isUpdateBannerVisible,
  reduceUpdateAvailableEvent,
  reduceUpdateStatusEvent,
  updateBannerMessage,
  type UpdateBannerState,
} from "./update-banner-state";

/**
 * Self-contained auto-update banner. Subscribes to the IPC-bridged
 * `desktop:update-status` / `desktop:update-available` window events (re-emitted
 * by preload.ts) and offers an "Update & restart" action that calls
 * applyUpdate() only once the update is downloaded. All visibility/apply gating
 * is delegated to the pure helpers in update-banner-state.ts.
 */
export function UpdateBanner() {
  const [state, setState] = useState<UpdateBannerState>(
    INITIAL_UPDATE_BANNER_STATE,
  );
  const [applying, setApplying] = useState(false);

  useDesktopEvent(
    "desktop:update-status",
    useCallback((detail) => {
      setState((prev) => reduceUpdateStatusEvent(prev, detail));
    }, []),
  );

  useDesktopEvent(
    "desktop:update-available",
    useCallback((detail) => {
      setState((prev) => reduceUpdateAvailableEvent(prev, detail));
    }, []),
  );

  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      await window.desktopApi.applyUpdate();
    } catch {
      // The main process rejects an apply before the update is downloaded;
      // re-enable the button so the user can retry once ready.
      setApplying(false);
    }
  }, []);

  if (!isUpdateBannerVisible(state)) {
    return null;
  }

  const isError = state.status === "error";

  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-3 px-4 py-2 text-sm border-b shrink-0 ${
        isError
          ? "bg-[var(--destructive)]/10 text-[var(--destructive)]"
          : "bg-[var(--primary)]/10 text-[var(--foreground)]"
      }`}
    >
      <span className="truncate">{updateBannerMessage(state)}</span>
      {isUpdateApplyEnabled(state) && (
        <Button
          size="sm"
          onClick={handleApply}
          disabled={applying}
          className="shrink-0"
        >
          {applying ? "Restarting..." : "Update & restart"}
        </Button>
      )}
    </div>
  );
}
