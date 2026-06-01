// hooks/use-copy-to-clipboard.ts
import { useCallback, useEffect, useRef, useState } from "react";
function useCopyToClipboard(resetDelayMs = 2e3) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef(null);
  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current === null) {
      return;
    }
    clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }, []);
  useEffect(() => clearResetTimer, [clearResetTimer]);
  const copy = useCallback(
    async (value) => {
      if (!value) {
        return false;
      }
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        return false;
      }
      setCopied(true);
      clearResetTimer();
      resetTimerRef.current = setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, resetDelayMs);
      return true;
    },
    [clearResetTimer, resetDelayMs]
  );
  return [copied, copy];
}

export {
  useCopyToClipboard
};
//# sourceMappingURL=chunk-JHIJKM5E.mjs.map