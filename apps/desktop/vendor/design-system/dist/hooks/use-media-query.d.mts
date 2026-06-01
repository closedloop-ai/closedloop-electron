/**
 * Subscribes to a CSS media query and re-renders when its match state changes.
 * Server snapshot is `false` to avoid hydration mismatches.
 */
declare function useMediaQuery(query: string): boolean;

export { useMediaQuery };
