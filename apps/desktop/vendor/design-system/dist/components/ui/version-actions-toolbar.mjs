import React from "react";
"use client";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import {
  Toggle
} from "../../chunk-XS6N43AI.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/version-actions-toolbar.tsx
import { MessageSquareDotIcon } from "lucide-react";
function VersionActionsToolbar({
  canRestoreVersion = false,
  onRestoreVersion,
  isRestoring = false,
  canSaveVersion = true,
  hasUnsavedChanges = true,
  onSaveVersion,
  isSaving = false,
  onToggleComments,
  openThreadCount,
  showComments,
  showCommentToggle = true
}) {
  return /* @__PURE__ */ React.createElement(React.Fragment, null, showCommentToggle && openThreadCount > 0 ? /* @__PURE__ */ React.createElement(
    Toggle,
    {
      className: "px-3",
      onPressedChange: onToggleComments,
      pressed: showComments,
      size: "sm",
      variant: "outline"
    },
    /* @__PURE__ */ React.createElement(MessageSquareDotIcon, { className: "h-4 w-4" }),
    openThreadCount
  ) : null, /* @__PURE__ */ React.createElement(
    Button,
    {
      disabled: !canRestoreVersion || isRestoring,
      onClick: onRestoreVersion,
      size: "sm",
      variant: "outline"
    },
    "Restore Version"
  ), canSaveVersion ? /* @__PURE__ */ React.createElement(
    Button,
    {
      disabled: isSaving || !hasUnsavedChanges,
      onClick: onSaveVersion,
      size: "sm",
      variant: "default"
    },
    isSaving ? "Publishing..." : "Publish"
  ) : null);
}
export {
  VersionActionsToolbar
};
//# sourceMappingURL=version-actions-toolbar.mjs.map