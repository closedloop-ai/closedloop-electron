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

// hooks/use-media-query.ts
var use_media_query_exports = {};
__export(use_media_query_exports, {
  useMediaQuery: () => useMediaQuery
});
module.exports = __toCommonJS(use_media_query_exports);
var import_react = require("react");
function useMediaQuery(query) {
  const subscribe = (0, import_react.useCallback)(
    (callback) => {
      const media = globalThis.matchMedia(query);
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    [query]
  );
  const getSnapshot = () => globalThis.matchMedia(query).matches;
  const getServerSnapshot = () => false;
  return (0, import_react.useSyncExternalStore)(subscribe, getSnapshot, getServerSnapshot);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  useMediaQuery
});
//# sourceMappingURL=use-media-query.js.map