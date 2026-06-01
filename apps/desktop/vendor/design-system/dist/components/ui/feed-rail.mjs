import React from "react";
"use client";
import {
  useMediaQuery
} from "../../chunk-4BFOJQ5H.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/feed-rail.tsx
import { useCallback } from "react";
var NARROW_VIEWPORT_QUERY = "(max-width: 1024px)";
var NARROW_OVERLAY_WIDTH = 400;
var FeedRailTab = {
  Feed: "feed",
  Chat: "chat"
};
function FeedRail({
  visible,
  onClose,
  width,
  onWidthChange,
  activeTab,
  hasChat,
  onTabChange,
  feedPanel,
  chatPanel
}) {
  const isNarrow = useMediaQuery(NARROW_VIEWPORT_QUERY);
  const startResize = useCallback(
    (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      function onMove(moveEvent) {
        onWidthChange(startWidth - (moveEvent.clientX - startX));
      }
      function onUp() {
        globalThis.window.removeEventListener("pointermove", onMove);
        globalThis.window.removeEventListener("pointerup", onUp);
      }
      globalThis.window.addEventListener("pointermove", onMove);
      globalThis.window.addEventListener("pointerup", onUp);
    },
    [onWidthChange, width]
  );
  if (!visible) {
    return null;
  }
  const effectiveTab = hasChat ? activeTab : FeedRailTab.Feed;
  return /* @__PURE__ */ React.createElement(React.Fragment, null, isNarrow ? /* @__PURE__ */ React.createElement(
    "button",
    {
      "aria-label": "Close feed rail",
      className: "fixed inset-0 z-40 bg-black/30",
      onClick: onClose,
      type: "button"
    }
  ) : null, /* @__PURE__ */ React.createElement(
    "aside",
    {
      className: isNarrow ? "fixed inset-y-0 right-0 z-50 flex flex-col border-l bg-background" : "relative flex shrink-0 flex-col border-l bg-background",
      style: { width: isNarrow ? NARROW_OVERLAY_WIDTH : width }
    },
    isNarrow ? null : /* @__PURE__ */ React.createElement(
      "button",
      {
        "aria-label": "Resize feed rail",
        className: "absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-primary/40",
        onPointerDown: startResize,
        type: "button"
      }
    ),
    /* @__PURE__ */ React.createElement("header", { className: "flex h-10 shrink-0 items-center border-b px-3" }, /* @__PURE__ */ React.createElement(
      "div",
      {
        "aria-label": "Feed mode",
        className: "flex items-center gap-1",
        role: "tablist"
      },
      /* @__PURE__ */ React.createElement(
        "button",
        {
          "aria-selected": effectiveTab === FeedRailTab.Feed,
          className: tabClasses(effectiveTab === FeedRailTab.Feed),
          onClick: () => onTabChange(FeedRailTab.Feed),
          role: "tab",
          type: "button"
        },
        "Feed"
      ),
      hasChat ? /* @__PURE__ */ React.createElement(
        "button",
        {
          "aria-selected": effectiveTab === FeedRailTab.Chat,
          className: tabClasses(effectiveTab === FeedRailTab.Chat),
          onClick: () => onTabChange(FeedRailTab.Chat),
          role: "tab",
          type: "button"
        },
        "Chat"
      ) : null
    )),
    /* @__PURE__ */ React.createElement("div", { className: "flex min-h-0 flex-1 flex-col" }, effectiveTab === FeedRailTab.Feed ? /* @__PURE__ */ React.createElement("div", { className: "flex min-h-0 flex-1 flex-col" }, feedPanel) : /* @__PURE__ */ React.createElement("div", { className: "flex min-h-0 flex-1 flex-col overflow-hidden" }, chatPanel))
  ));
}
function tabClasses(active) {
  return active ? "rounded px-2 py-1 font-medium text-foreground text-xs" : "rounded px-2 py-1 text-muted-foreground text-xs hover:text-foreground";
}
export {
  FeedRail,
  FeedRailTab
};
//# sourceMappingURL=feed-rail.mjs.map