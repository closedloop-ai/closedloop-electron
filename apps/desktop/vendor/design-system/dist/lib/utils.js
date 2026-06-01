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

// lib/utils.ts
var utils_exports = {};
__export(utils_exports, {
  capitalize: () => capitalize,
  cn: () => cn,
  handleError: () => handleError
});
module.exports = __toCommonJS(utils_exports);
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));
var capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);
var parseError = (error) => {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
};
var handleError = (error) => {
  const message = parseError(error);
  import_sonner.toast.error(message);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  capitalize,
  cn,
  handleError
});
//# sourceMappingURL=utils.js.map