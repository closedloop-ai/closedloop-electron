import React from "react";
"use client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../../chunk-DAQXDCVF.mjs";
import "../../chunk-TT7DUYOP.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/integration-disconnect-dialog.tsx
function IntegrationDisconnectDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel = "Disconnect",
  pendingLabel = "Disconnecting...",
  isPending = false
}) {
  return /* @__PURE__ */ React.createElement(AlertDialog, { onOpenChange, open }, /* @__PURE__ */ React.createElement(AlertDialogContent, null, /* @__PURE__ */ React.createElement(AlertDialogHeader, null, /* @__PURE__ */ React.createElement(AlertDialogTitle, null, title), /* @__PURE__ */ React.createElement(AlertDialogDescription, null, description)), /* @__PURE__ */ React.createElement(AlertDialogFooter, null, /* @__PURE__ */ React.createElement(AlertDialogCancel, null, "Cancel"), /* @__PURE__ */ React.createElement(AlertDialogAction, { disabled: isPending, onClick: onConfirm }, isPending ? pendingLabel : confirmLabel))));
}
export {
  IntegrationDisconnectDialog
};
//# sourceMappingURL=integration-disconnect-dialog.mjs.map