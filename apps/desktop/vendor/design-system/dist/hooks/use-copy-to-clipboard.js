"use strict";
"use client";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// hooks/use-copy-to-clipboard.ts
var use_copy_to_clipboard_exports = {};
__export(use_copy_to_clipboard_exports, {
  useCopyToClipboard: () => useCopyToClipboard
});
module.exports = __toCommonJS(use_copy_to_clipboard_exports);
var import_react = require("react");
function useCopyToClipboard(resetDelayMs = 2e3) {
  const [copied, setCopied] = (0, import_react.useState)(false);
  const resetTimerRef = (0, import_react.useRef)(null);
  const clearResetTimer = (0, import_react.useCallback)(() => {
    if (resetTimerRef.current === null) {
      return;
    }
    clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }, []);
  (0, import_react.useEffect)(() => clearResetTimer, [clearResetTimer]);
  const copy = (0, import_react.useCallback)(
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  useCopyToClipboard
});
//# sourceMappingURL=use-copy-to-clipboard.js.map