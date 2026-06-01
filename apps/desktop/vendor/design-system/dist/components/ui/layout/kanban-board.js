var React = require("react");
"use strict";
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

// components/ui/layout/kanban-board.tsx
var kanban_board_exports = {};
__export(kanban_board_exports, {
  KanbanBoardLayout: () => KanbanBoardLayout,
  KanbanCardFrame: () => KanbanCardFrame,
  KanbanColumn: () => KanbanColumn,
  KanbanColumnHeader: () => KanbanColumnHeader,
  KanbanColumnLayout: () => KanbanColumnLayout
});
module.exports = __toCommonJS(kanban_board_exports);
var import_react = require("react");

// components/ui/scroll-area.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/scroll-area.tsx
function ScrollArea({
  className,
  children,
  scrollbars = "vertical",
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.ScrollArea.Root,
    {
      "data-slot": "scroll-area",
      className: cn("relative", className),
      ...props
    },
    /* @__PURE__ */ React2.createElement(
      import_radix_ui.ScrollArea.Viewport,
      {
        "data-slot": "scroll-area-viewport",
        className: "focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
      },
      children
    ),
    (scrollbars === "vertical" || scrollbars === "both") && /* @__PURE__ */ React2.createElement(ScrollBar, { orientation: "vertical" }),
    (scrollbars === "horizontal" || scrollbars === "both") && /* @__PURE__ */ React2.createElement(ScrollBar, { orientation: "horizontal" }),
    scrollbars === "both" && /* @__PURE__ */ React2.createElement(import_radix_ui.ScrollArea.Corner, null)
  );
}
function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.ScrollArea.ScrollAreaScrollbar,
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
    /* @__PURE__ */ React2.createElement(
      import_radix_ui.ScrollArea.ScrollAreaThumb,
      {
        "data-slot": "scroll-area-thumb",
        className: "bg-border relative flex-1 rounded-full"
      }
    )
  );
}

// components/ui/layout/kanban-board.tsx
function KanbanBoardLayout({
  children,
  className,
  contentClassName,
  style
}) {
  return /* @__PURE__ */ React.createElement(
    ScrollArea,
    {
      className: cn("min-h-0 shrink-0", className),
      scrollbars: "horizontal",
      style,
      type: "always"
    },
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cn("flex min-w-max gap-3 px-4 pb-4", contentClassName),
        style
      },
      children
    )
  );
}
function KanbanColumnLayout({
  header,
  children,
  emptyState,
  footer,
  className,
  bodyClassName
}) {
  const hasChildren = import_react.Children.count(children) > 0;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "flex min-h-0 w-[280px] shrink-0 flex-col overflow-hidden rounded-xl border bg-card/95 shadow-sm",
        className
      )
    },
    /* @__PURE__ */ React.createElement("div", { className: "shrink-0 border-b px-3 py-3" }, header),
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cn(
          "min-h-0 flex-1 overflow-y-auto p-1.5",
          bodyClassName
        )
      },
      hasChildren ? children : emptyState
    ),
    footer ? /* @__PURE__ */ React.createElement("div", { className: "shrink-0 border-t px-2 py-1.5" }, footer) : null
  );
}
function KanbanColumn({
  title,
  count,
  icon,
  trailing,
  children,
  emptyState,
  footer,
  className,
  bodyClassName,
  headerClassName,
  highlighted = false,
  highlightedBodyClassName = "bg-accent/20"
}) {
  return /* @__PURE__ */ React.createElement(
    KanbanColumnLayout,
    {
      bodyClassName: cn(
        "transition-colors",
        highlighted && highlightedBodyClassName,
        bodyClassName
      ),
      className,
      emptyState,
      footer,
      header: /* @__PURE__ */ React.createElement(
        KanbanColumnHeader,
        {
          className: headerClassName,
          count,
          icon,
          title,
          trailing
        }
      )
    },
    children
  );
}
function KanbanColumnHeader({
  icon,
  title,
  count,
  trailing,
  className
}) {
  return /* @__PURE__ */ React.createElement("div", { className: cn("flex items-center gap-2", className) }, icon ? /* @__PURE__ */ React.createElement("span", { className: "shrink-0" }, icon) : null, /* @__PURE__ */ React.createElement("span", { className: "font-medium text-base" }, title), count !== void 0 ? /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-sm" }, count) : null, trailing ? /* @__PURE__ */ React.createElement("div", { className: "ml-auto shrink-0" }, trailing) : null);
}
function KanbanCardFrame({
  children,
  className,
  active = false
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "rounded-md border bg-card py-2 transition-colors",
        active && "border-primary/35 bg-primary/8 ring-1 ring-primary/20",
        className
      )
    },
    children
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KanbanBoardLayout,
  KanbanCardFrame,
  KanbanColumn,
  KanbanColumnHeader,
  KanbanColumnLayout
});
//# sourceMappingURL=kanban-board.js.map