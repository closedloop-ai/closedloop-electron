"use strict";
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

// components/ui/types.ts
var types_exports = {};
__export(types_exports, {
  AGENT_STATUS: () => AGENT_STATUS,
  CLI_TOOL_STATE: () => CLI_TOOL_STATE,
  SESSION_STATUS: () => SESSION_STATUS,
  TONE: () => TONE
});
module.exports = __toCommonJS(types_exports);
var SESSION_STATUS = {
  ACTIVE: "active",
  WAITING: "waiting",
  COMPLETED: "completed",
  ERROR: "error",
  ABANDONED: "abandoned"
};
var AGENT_STATUS = {
  WORKING: "working",
  WAITING: "waiting",
  COMPLETED: "completed",
  ERROR: "error",
  IDLE: "idle"
};
var TONE = {
  DEFAULT: "default",
  SUCCESS: "success",
  WARNING: "warning",
  DANGER: "danger",
  INFO: "info",
  ACCENT: "accent",
  MUTED: "muted"
};
var CLI_TOOL_STATE = {
  CHECKING: "checking",
  DETECTED: "detected",
  CUSTOM: "custom",
  INVALID: "invalid",
  MISSING: "missing"
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AGENT_STATUS,
  CLI_TOOL_STATE,
  SESSION_STATUS,
  TONE
});
//# sourceMappingURL=types.js.map