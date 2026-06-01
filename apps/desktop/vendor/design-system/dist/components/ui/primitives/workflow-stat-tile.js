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

// components/ui/primitives/workflow-stat-tile.tsx
var workflow_stat_tile_exports = {};
__export(workflow_stat_tile_exports, {
  WorkflowStatTile: () => WorkflowStatTile
});
module.exports = __toCommonJS(workflow_stat_tile_exports);

// components/ui/badge.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/badge.tsx
var badgeVariants = (0, import_class_variance_authority.cva)(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive: "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        success: "border-success/25 bg-success/12 text-success [a&]:hover:bg-success/18",
        warning: "border-warning/30 bg-warning/14 text-warning-foreground [a&]:hover:bg-warning/20",
        info: "border-info/25 bg-info/12 text-info [a&]:hover:bg-info/18",
        accent: "border-primary/20 bg-primary/10 text-primary [a&]:hover:bg-primary/16",
        muted: "border-border bg-muted/70 text-muted-foreground [a&]:hover:bg-muted",
        outline: "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);
function Badge({
  className,
  variant,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? import_radix_ui.Slot.Slot : "span";
  return /* @__PURE__ */ React2.createElement(
    Comp,
    {
      "data-slot": "badge",
      className: cn(badgeVariants({ variant }), className),
      ...props
    }
  );
}

// components/ui/card.tsx
var React3 = __toESM(require("react"));
function Card({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "div",
    {
      "data-slot": "card",
      className: cn(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
        className
      ),
      ...props
    }
  );
}
function CardHeader({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "div",
    {
      "data-slot": "card-header",
      className: cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      ),
      ...props
    }
  );
}
function CardTitle({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "div",
    {
      "data-slot": "card-title",
      className: cn("leading-none font-semibold", className),
      ...props
    }
  );
}
function CardDescription({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "div",
    {
      "data-slot": "card-description",
      className: cn("text-muted-foreground text-sm", className),
      ...props
    }
  );
}
function CardContent({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "div",
    {
      "data-slot": "card-content",
      className: cn("px-6", className),
      ...props
    }
  );
}

// components/ui/primitives/workflow-stat-tile.tsx
function WorkflowStatTile({
  label,
  value,
  description,
  eyebrow,
  icon: Icon,
  meta,
  className
}) {
  return /* @__PURE__ */ React.createElement(Card, { className: cn("border-border/80 bg-card/95 shadow-sm", className) }, /* @__PURE__ */ React.createElement(CardHeader, { className: "flex flex-row items-start justify-between gap-4 space-y-0 pb-3" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, eyebrow ? /* @__PURE__ */ React.createElement(
    Badge,
    {
      className: "rounded-md px-1.5 py-0.5 text-[10px]",
      variant: "muted"
    },
    eyebrow
  ) : null, /* @__PURE__ */ React.createElement(CardDescription, { className: "font-semibold text-[11px] uppercase tracking-[0.12em]" }, label), /* @__PURE__ */ React.createElement(CardTitle, { className: "font-semibold text-2xl tracking-tight" }, value)), Icon ? /* @__PURE__ */ React.createElement("span", { className: "flex size-9 items-center justify-center rounded-xl border border-primary/10 bg-primary/10 text-primary" }, /* @__PURE__ */ React.createElement(Icon, { className: "size-4" })) : null), description || meta ? /* @__PURE__ */ React.createElement(CardContent, { className: "flex items-end justify-between gap-3 pt-0" }, description ? /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, description) : /* @__PURE__ */ React.createElement("span", null), meta) : null);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  WorkflowStatTile
});
//# sourceMappingURL=workflow-stat-tile.js.map