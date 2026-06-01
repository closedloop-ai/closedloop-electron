import React from "react";
"use client";
import {
  Badge
} from "../../chunk-3I7NW6GS.mjs";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/desktop-security.tsx
import { DesktopSecurityStatus } from "@repo/api/src/types/compute-target";
import { Download, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
function getTargetSecurity(target) {
  return target?.security ?? {
    status: DesktopSecurityStatus.Unknown,
    reason: "LOOKUP_FAILED",
    upgradeSupported: false
  };
}
function getSecurityLabel(security) {
  if (security.reason === "FEATURE_DISABLED") {
    return "Standard";
  }
  if (security.status === DesktopSecurityStatus.Protected) {
    return "Protected";
  }
  if (security.status === DesktopSecurityStatus.UpgradeAvailable) {
    return "Upgrade available";
  }
  if (security.status === DesktopSecurityStatus.LegacyManual) {
    return "Reconnect Desktop";
  }
  if (security.status === DesktopSecurityStatus.Unknown) {
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
  return /* @__PURE__ */ React.createElement(Badge, { className: "gap-1", variant: "outline" }, security.status === DesktopSecurityStatus.Protected ? /* @__PURE__ */ React.createElement(ShieldCheck, { className: "size-3" }) : /* @__PURE__ */ React.createElement(ShieldAlert, { className: "size-3" }), getSecurityLabel(security));
}
function DesktopUpdateDownloadButton({
  downloadUrl,
  isLoading
}) {
  if (downloadUrl) {
    return /* @__PURE__ */ React.createElement(Button, { asChild: true, size: "sm", variant: "outline" }, /* @__PURE__ */ React.createElement("a", { href: downloadUrl, rel: "noreferrer", target: "_blank" }, /* @__PURE__ */ React.createElement(Download, { className: "h-4 w-4" }), "Download update"));
  }
  return /* @__PURE__ */ React.createElement(Button, { disabled: true, size: "sm", variant: "outline" }, isLoading ? /* @__PURE__ */ React.createElement(Loader2, { className: "h-4 w-4 animate-spin" }) : /* @__PURE__ */ React.createElement(Download, { className: "h-4 w-4" }), isLoading ? "Loading update" : "Download unavailable");
}
export {
  DesktopSecurityBadge,
  DesktopUpdateDownloadButton,
  getSecurityLabel,
  getTargetSecurity,
  requiresDesktopUpdateAction
};
//# sourceMappingURL=desktop-security.mjs.map