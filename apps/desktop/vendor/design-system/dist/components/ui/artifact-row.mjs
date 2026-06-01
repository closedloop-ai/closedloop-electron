import React from "react";
"use client";
import {
  StatusIcon
} from "../../chunk-U2HXSCXU.mjs";
import "../../chunk-TQBNQE2F.mjs";
import {
  require_link
} from "../../chunk-D6PSM7AT.mjs";
import {
  PriorityIcon
} from "../../chunk-WYVITJCG.mjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../../chunk-M266NC23.mjs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../chunk-MRSDI6D5.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import {
  __toESM
} from "../../chunk-LZOMFHX3.mjs";

// components/ui/artifact-row.tsx
var import_link = __toESM(require_link());
import {
  CornerDownRightIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  Link2OffIcon
} from "lucide-react";
function ArtifactRow({
  title,
  slug,
  typeIcon,
  typeLabel,
  status,
  statusLabel,
  priority,
  assignee,
  href,
  depth = 1,
  onDetach,
  className
}) {
  const isChild = depth > 1;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "group/row relative flex items-center gap-2 border-b py-2.5 pr-2 pl-2 hover:bg-accent/50",
        href ? "cursor-pointer" : "cursor-default",
        className
      )
    },
    isChild ? /* @__PURE__ */ React.createElement(
      CornerDownRightIcon,
      {
        "aria-hidden": true,
        className: "h-4 w-4 shrink-0 text-muted-foreground opacity-50"
      }
    ) : null,
    /* @__PURE__ */ React.createElement("span", { className: "flex shrink-0 items-center text-muted-foreground" }, typeIcon),
    /* @__PURE__ */ React.createElement("span", { className: "mr-1.5 ml-1 inline-block min-w-[7ch] shrink-0 font-mono text-muted-foreground text-xs" }, slug),
    /* @__PURE__ */ React.createElement(Tooltip, null, /* @__PURE__ */ React.createElement(TooltipTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(
      "button",
      {
        "aria-label": statusLabel,
        className: "relative z-10 inline-flex shrink-0 items-center",
        type: "button"
      },
      /* @__PURE__ */ React.createElement(StatusIcon, { size: 16, status })
    )), /* @__PURE__ */ React.createElement(TooltipContent, null, statusLabel)),
    href ? /* @__PURE__ */ React.createElement(
      import_link.default,
      {
        className: "min-w-0 flex-1 truncate font-medium text-sm after:absolute after:inset-0",
        href
      },
      title
    ) : /* @__PURE__ */ React.createElement("span", { className: "min-w-0 flex-1 truncate font-medium text-sm" }, title),
    /* @__PURE__ */ React.createElement("div", { className: "relative z-10 flex shrink-0 items-center gap-4" }, assignee, priority ? /* @__PURE__ */ React.createElement("div", { className: "flex h-5 w-5 items-center justify-center" }, /* @__PURE__ */ React.createElement(PriorityIcon, { priority })) : null, /* @__PURE__ */ React.createElement(DropdownMenu, null, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(
      "button",
      {
        "aria-label": "More actions",
        className: "flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground",
        type: "button"
      },
      /* @__PURE__ */ React.createElement(EllipsisIcon, { className: "h-4 w-4" })
    )), /* @__PURE__ */ React.createElement(DropdownMenuContent, { align: "end" }, href ? /* @__PURE__ */ React.createElement(DropdownMenuItem, { asChild: true }, /* @__PURE__ */ React.createElement(import_link.default, { href }, /* @__PURE__ */ React.createElement(ExternalLinkIcon, { className: "h-4 w-4" }), "View ", typeLabel)) : /* @__PURE__ */ React.createElement(DropdownMenuItem, { disabled: true }, /* @__PURE__ */ React.createElement(ExternalLinkIcon, { className: "h-4 w-4" }), "View ", typeLabel), /* @__PURE__ */ React.createElement(DropdownMenuItem, { disabled: !onDetach, onClick: onDetach }, /* @__PURE__ */ React.createElement(Link2OffIcon, { className: "h-4 w-4" }), "Detach Association"))))
  );
}
export {
  ArtifactRow
};
//# sourceMappingURL=artifact-row.mjs.map