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

// components/ui/composites/orchestration-dag.tsx
var orchestration_dag_exports = {};
__export(orchestration_dag_exports, {
  OrchestrationDag: () => OrchestrationDag
});
module.exports = __toCommonJS(orchestration_dag_exports);

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

// components/ui/layout/section.tsx
function Section({
  title,
  description,
  actions,
  children,
  className,
  contentClassName
}) {
  return /* @__PURE__ */ React.createElement(Card, { className: cn("border-border/80 bg-card/95 shadow-sm", className) }, /* @__PURE__ */ React.createElement(CardHeader, { className: "flex flex-row items-start justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, /* @__PURE__ */ React.createElement(CardTitle, null, title), description ? /* @__PURE__ */ React.createElement(CardDescription, null, description) : null), actions), /* @__PURE__ */ React.createElement(CardContent, { className: contentClassName }, children));
}

// components/ui/composites/orchestration-dag.tsx
function buildNodes(data) {
  return [
    {
      id: "sessions",
      label: "Sessions",
      layer: 0,
      count: data.sessionCount
    },
    {
      id: "main",
      label: "Main agent",
      layer: 1,
      count: data.mainCount
    },
    ...data.subagentTypes.map((item) => ({
      id: item.subagentType,
      label: item.subagentType,
      layer: 2,
      count: item.count
    })),
    {
      id: "compactions",
      label: "Compactions",
      layer: 3,
      count: data.compactions.total
    },
    ...data.outcomes.map((outcome) => ({
      id: outcome.status,
      label: outcome.status,
      layer: 4,
      count: outcome.count
    }))
  ];
}
function truncateLabel(label, maxLength = 14) {
  if (label.length <= maxLength) {
    return label;
  }
  return `${label.slice(0, maxLength - 1)}\u2026`;
}
function OrchestrationDag({
  data
}) {
  const nodes = buildNodes(data);
  const layers = Array.from(new Set(nodes.map((node) => node.layer)));
  const layerWidth = 220;
  const rowHeight = 72;
  const padding = 28;
  const positions = /* @__PURE__ */ new Map();
  for (const layer of layers) {
    const layerNodes = nodes.filter((node) => node.layer === layer);
    for (const [index, node] of layerNodes.entries()) {
      positions.set(node.id, {
        x: padding + layer * layerWidth,
        y: padding + index * rowHeight + (layer === 2 ? 10 : 0)
      });
    }
  }
  const width = padding * 2 + layerWidth * Math.max(layers.length - 1, 1) + 180;
  const height = padding * 2 + Math.max(
    ...layers.map(
      (layer) => nodes.filter((node) => node.layer === layer).length
    )
  ) * rowHeight + 20;
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-4",
      description: "Layered orchestration map across sessions, agents, compactions, and outcomes.",
      title: "Agent orchestration"
    },
    /* @__PURE__ */ React.createElement(
      "svg",
      {
        "aria-label": "Agent orchestration graph",
        className: "w-full overflow-visible",
        viewBox: `0 0 ${width} ${height}`
      },
      data.edges.map((edge) => {
        const source = positions.get(edge.source);
        const target = positions.get(edge.target);
        if (!(source && target)) {
          return null;
        }
        const startX = source.x + 132;
        const startY = source.y + 20;
        const endX = target.x;
        const endY = target.y + 20;
        const midX = (startX + endX) / 2;
        return /* @__PURE__ */ React.createElement(
          "path",
          {
            d: `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`,
            fill: "none",
            key: `${edge.source}-${edge.target}`,
            stroke: "var(--primary)",
            strokeOpacity: "0.35",
            strokeWidth: Math.max(1.5, edge.weight / 22)
          }
        );
      }),
      nodes.map((node) => {
        const position = positions.get(node.id);
        if (!position) {
          return null;
        }
        return /* @__PURE__ */ React.createElement(
          "g",
          {
            key: node.id,
            transform: `translate(${position.x}, ${position.y})`
          },
          /* @__PURE__ */ React.createElement(
            "rect",
            {
              fill: "var(--card)",
              height: "40",
              rx: "12",
              stroke: "var(--border)",
              width: "132"
            }
          ),
          /* @__PURE__ */ React.createElement(
            "text",
            {
              fill: "var(--foreground)",
              fontSize: "12",
              fontWeight: "600",
              x: "14",
              y: "17"
            },
            truncateLabel(node.label)
          ),
          /* @__PURE__ */ React.createElement(
            "text",
            {
              fill: "var(--muted-foreground)",
              fontSize: "11",
              x: "14",
              y: "30"
            },
            node.count,
            " instances"
          )
        );
      })
    ),
    /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-2" }, data.outcomes.map((outcome) => /* @__PURE__ */ React.createElement(
      Badge,
      {
        key: outcome.status,
        variant: outcome.status === "completed" ? "success" : "muted"
      },
      outcome.status,
      ": ",
      outcome.count
    )), /* @__PURE__ */ React.createElement(Badge, { variant: "accent" }, "compactions: ", data.compactions.total))
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  OrchestrationDag
});
//# sourceMappingURL=orchestration-dag.js.map