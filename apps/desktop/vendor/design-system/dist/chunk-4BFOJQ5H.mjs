// hooks/use-media-query.ts
import { useCallback, useSyncExternalStore } from "react";
function useMediaQuery(query) {
  const subscribe = useCallback(
    (callback) => {
      const media = globalThis.matchMedia(query);
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    [query]
  );
  const getSnapshot = () => globalThis.matchMedia(query).matches;
  const getServerSnapshot = () => false;
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export {
  useMediaQuery
};
//# sourceMappingURL=chunk-4BFOJQ5H.mjs.map