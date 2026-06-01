/**
 * Copies text to the system clipboard and exposes a short-lived
 * `copied` state suitable for icon-swap confirmation. Returns
 * `[copied, copy]` where `copy(value)` resolves to `true` on success
 * and `false` when the clipboard write rejects (permission denied,
 * insecure context, etc.) or `value` is falsy.
 */
declare function useCopyToClipboard(resetDelayMs?: number): readonly [boolean, (value: string | null | undefined) => Promise<boolean>];

export { useCopyToClipboard };
