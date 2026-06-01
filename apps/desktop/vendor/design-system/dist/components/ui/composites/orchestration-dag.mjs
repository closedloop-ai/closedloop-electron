import React from "react";
import {
  Section
} from "../../../chunk-ZF7NKEIL.mjs";
import {
  Badge
} from "../../../chunk-3I7NW6GS.mjs";
import "../../../chunk-ZKMGHYX7.mjs";
import "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-LZOMFHX3.mjs";

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
export {
  OrchestrationDag
};
//# sourceMappingURL=orchestration-dag.mjs.map