import React from "react";
import {
  ScrollArea
} from "./chunk-4VG3CUB2.mjs";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/layout/kanban-board.tsx
import { Children } from "react";
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
  const hasChildren = Children.count(children) > 0;
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

export {
  KanbanBoardLayout,
  KanbanColumnLayout,
  KanbanColumn,
  KanbanColumnHeader,
  KanbanCardFrame
};
//# sourceMappingURL=chunk-EYIDES2P.mjs.map