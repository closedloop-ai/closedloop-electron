var React = require("react");
"use strict";
"use client";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// components/ui/desktop-security.tsx
var desktop_security_exports = {};
__export(desktop_security_exports, {
  DesktopSecurityBadge: () => DesktopSecurityBadge,
  DesktopUpdateDownloadButton: () => DesktopUpdateDownloadButton,
  getSecurityLabel: () => getSecurityLabel,
  getTargetSecurity: () => getTargetSecurity,
  requiresDesktopUpdateAction: () => requiresDesktopUpdateAction
});
module.exports = __toCommonJS(desktop_security_exports);
var import_compute_target = require("@repo/api/src/types/compute-target");

// components/ui/badge.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/badge.tsx
var badgeVariants = (0, import_class_variance_authority.cva)(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive: "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        success: "border-success/25 bg-success/12 text-success [a&]:hover:bg-success/18",
        warning: "border-warning/30 bg-warning/14 text-warning-foreground [a&]:hover:bg-warning/20",
        info: "border-info/25 bg-info/12 text-info [a&]:hover:bg-info/18",
        accent: "border-primary/20 bg-primary/10 text-primary [a&]:hover:bg-primary/16",
        muted: "border-border bg-muted/70 text-muted-foreground [a&]:hover:bg-muted",
        outline: "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);
function Badge({
  className,
  variant,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? import_radix_ui.Slot.Slot : "span";
  return /* @__PURE__ */ React2.createElement(
    Comp,
    {
      "data-slot": "badge",
      className: cn(badgeVariants({ variant }), className),
      ...props
    }
  );
}

// components/ui/button.tsx
var React3 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_class_variance_authority2 = require("class-variance-authority");
var buttonVariants = (0, import_class_variance_authority2.cva)(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline: "border border-input-border bg-input hover:bg-muted hover:text-foreground dark:bg-input dark:hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4 gap-2 py-2 has-[>svg]:px-3 [&_svg:not([class*='size-'])]:size-4",
        sm: "h-8 rounded-md gap-2 px-3 has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 rounded-md gap-2 px-6 has-[>svg]:px-4 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-9 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-4"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);
function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? import_radix_ui2.Slot.Slot : "button";
  return /* @__PURE__ */ React3.createElement(
    Comp,
    {
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size, className })),
      ...props
    }
  );
}

// components/ui/desktop-security.tsx
var import_lucide_react = require("lucide-react");
function getTargetSecurity(target) {
  return target?.security ?? {
    status: import_compute_target.DesktopSecurityStatus.Unknown,
    reason: "LOOKUP_FAILED",
    upgradeSupported: false
  };
}
function getSecurityLabel(security) {
  if (security.reason === "FEATURE_DISABLED") {
    return "Standard";
  }
  if (security.status === import_compute_target.DesktopSecurityStatus.Protected) {
    return "Protected";
  }
  if (security.status === import_compute_target.DesktopSecurityStatus.UpgradeAvailable) {
    return "Upgrade available";
  }
  if (security.status === import_compute_target.DesktopSecurityStatus.LegacyManual) {
    return "Reconnect Desktop";
  }
  if (security.status === import_compute_target.DesktopSecurityStatus.Unknown) {
    return "Status unavailable";
  }
  if (security.reason === "MISSING_GATEWAY_ID" || security.reason === "UNSUPPORTED_DESKTOP_VERSION") {
    return "Update required";
  }
  return "Not upgradeable";
}
function requiresDesktopUpdateAction(security) {
  return security.reason === "MISSING_GATEWAY_ID" || security.reason === "UNSUPPORTED_DESKTOP_VERSION";
}
function DesktopSecurityBadge({
  security
}) {
  return /* @__PURE__ */ React.createElement(Badge, { className: "gap-1", variant: "outline" }, security.status === import_compute_target.DesktopSecurityStatus.Protected ? /* @__PURE__ */ React.createElement(import_lucide_react.ShieldCheck, { className: "size-3" }) : /* @__PURE__ */ React.createElement(import_lucide_react.ShieldAlert, { className: "size-3" }), getSecurityLabel(security));
}
function DesktopUpdateDownloadButton({
  downloadUrl,
  isLoading
}) {
  if (downloadUrl) {
    return /* @__PURE__ */ React.createElement(Button, { asChild: true, size: "sm", variant: "outline" }, /* @__PURE__ */ React.createElement("a", { href: downloadUrl, rel: "noreferrer", target: "_blank" }, /* @__PURE__ */ React.createElement(import_lucide_react.Download, { className: "h-4 w-4" }), "Download update"));
  }
  return /* @__PURE__ */ React.createElement(Button, { disabled: true, size: "sm", variant: "outline" }, isLoading ? /* @__PURE__ */ React.createElement(import_lucide_react.Loader2, { className: "h-4 w-4 animate-spin" }) : /* @__PURE__ */ React.createElement(import_lucide_react.Download, { className: "h-4 w-4" }), isLoading ? "Loading update" : "Download unavailable");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DesktopSecurityBadge,
  DesktopUpdateDownloadButton,
  getSecurityLabel,
  getTargetSecurity,
  requiresDesktopUpdateAction
});
//# sourceMappingURL=desktop-security.js.map