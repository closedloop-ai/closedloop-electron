import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/scroll-area.tsx
import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
function ScrollArea({
  className,
  children,
  scrollbars = "vertical",
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    ScrollAreaPrimitive.Root,
    {
      "data-slot": "scroll-area",
      className: cn("relative", className),
      ...props
    },
    /* @__PURE__ */ React.createElement(
      ScrollAreaPrimitive.Viewport,
      {
        "data-slot": "scroll-area-viewport",
        className: "focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
      },
      children
    ),
    (scrollbars === "vertical" || scrollbars === "both") && /* @__PURE__ */ React.createElement(ScrollBar, { orientation: "vertical" }),
    (scrollbars === "horizontal" || scrollbars === "both") && /* @__PURE__ */ React.createElement(ScrollBar, { orientation: "horizontal" }),
    scrollbars === "both" && /* @__PURE__ */ React.createElement(ScrollAreaPrimitive.Corner, null)
  );
}
function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    ScrollAreaPrimitive.ScrollAreaScrollbar,
    {
      "data-slot": "scroll-area-scrollbar",
      orientation,
      className: cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React.createElement(
      ScrollAreaPrimitive.ScrollAreaThumb,
      {
        "data-slot": "scroll-area-thumb",
        className: "bg-border relative flex-1 rounded-full"
      }
    )
  );
}

export {
  ScrollArea,
  ScrollBar
};
//# sourceMappingURL=chunk-4VG3CUB2.mjs.map