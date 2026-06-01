import React from "react";
"use client";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/comment-thread-action-footer.tsx
function CommentThreadActionFooter({
  label,
  isPending = false,
  icon,
  onClick
}) {
  return /* @__PURE__ */ React.createElement("div", { className: "flex justify-end border-border border-t bg-muted/20 px-3 py-2" }, /* @__PURE__ */ React.createElement(
    Button,
    {
      "data-comment-control": "true",
      disabled: isPending,
      onClick: (event) => {
        event.stopPropagation();
        onClick();
      },
      size: "sm",
      type: "button",
      variant: "secondary"
    },
    icon,
    label
  ));
}
export {
  CommentThreadActionFooter
};
//# sourceMappingURL=comment-thread-action-footer.mjs.map