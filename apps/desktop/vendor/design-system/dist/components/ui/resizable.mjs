"use client";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/resizable.tsx
import * as React from "react";
import { GripVerticalIcon } from "lucide-react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle
} from "react-resizable-panels";
function ResizablePanelGroup({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    PanelGroup,
    {
      "data-slot": "resizable-panel-group",
      className: cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className
      ),
      ...props
    }
  );
}
function ResizablePanel({ ...props }) {
  return /* @__PURE__ */ React.createElement(Panel, { "data-slot": "resizable-panel", ...props });
}
function ResizableHandle({
  withHandle,
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    PanelResizeHandle,
    {
      "data-slot": "resizable-handle",
      className: cn(
        "bg-border focus-visible:ring-ring relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:translate-x-0 data-[panel-group-direction=vertical]:after:-translate-y-1/2 [&[data-panel-group-direction=vertical]>div]:rotate-90",
        className
      ),
      ...props
    },
    withHandle ? /* @__PURE__ */ React.createElement("div", { className: "bg-border z-10 flex h-4 w-3 items-center justify-center rounded-xs border" }, /* @__PURE__ */ React.createElement(GripVerticalIcon, { className: "size-2.5" })) : null
  );
}
export {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
};
//# sourceMappingURL=resizable.mjs.map