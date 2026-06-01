import React from "react";
"use client";
import {
  Chip
} from "../../../chunk-TX5PRGT7.mjs";
import {
  cn
} from "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/primitives/pull-request-chip.tsx
import { GitPullRequest } from "lucide-react";
function PullRequestChip({
  repo,
  number,
  title,
  href,
  className,
  ...props
}) {
  const content = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(GitPullRequest, { className: "size-3.5" }), /* @__PURE__ */ React.createElement("span", { className: "truncate" }, repo, "#", number));
  if (href) {
    return /* @__PURE__ */ React.createElement(
      Chip,
      {
        asChild: true,
        className: cn("max-w-full", className),
        interactive: true,
        size: "default",
        title: title || `${repo}#${number}`,
        variant: "outline"
      },
      /* @__PURE__ */ React.createElement("a", { href, rel: "noreferrer", target: "_blank" }, content)
    );
  }
  return /* @__PURE__ */ React.createElement(
    Chip,
    {
      asChild: true,
      className: cn("max-w-full", className),
      interactive: true,
      size: "default",
      title: title || `${repo}#${number}`,
      variant: "outline"
    },
    /* @__PURE__ */ React.createElement("button", { type: "button", ...props }, content)
  );
}
export {
  PullRequestChip
};
//# sourceMappingURL=pull-request-chip.mjs.map