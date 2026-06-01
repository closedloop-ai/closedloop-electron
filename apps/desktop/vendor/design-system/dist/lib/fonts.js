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

// lib/fonts.ts
var fonts_exports = {};
__export(fonts_exports, {
  fonts: () => fonts
});
module.exports = __toCommonJS(fonts_exports);

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// lib/fonts.ts
var import_mono = require("geist/font/mono");
var import_sans = require("geist/font/sans");
var fonts = cn(
  import_sans.GeistSans.variable,
  import_mono.GeistMono.variable,
  "touch-manipulation font-sans antialiased"
);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  fonts
});
//# sourceMappingURL=fonts.js.map