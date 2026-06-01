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

// components/ui/composites/agent-pipeline-graph.tsx
var agent_pipeline_graph_exports = {};
__export(agent_pipeline_graph_exports, {
  AgentPipelineGraph: () => AgentPipelineGraph
});
module.exports = __toCommonJS(agent_pipeline_graph_exports);

// components/ui/card.tsx
var React2 = __toESM(require("react"));

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/card.tsx
function Card({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
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
  return /* @__PURE__ */ React2.createElement(
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
  return /* @__PURE__ */ React2.createElement(
    "div",
    {
      "data-slot": "card-title",
      className: cn("leading-none font-semibold", className),
      ...props
    }
  );
}
function CardDescription({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "div",
    {
      "data-slot": "card-description",
      className: cn("text-muted-foreground text-sm", className),
      ...props
    }
  );
}
function CardContent({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
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

// components/ui/primitives/graph.tsx
var d3 = __toESM(require("d3"));
var import_react = require("react");
var DEFAULT_NODE_COLORS = [
  "#6366f1",
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#ef4444",
  "#14b8a6"
];
var DEFAULT_NODE_STROKES = [
  "#818cf8",
  "#60a5fa",
  "#4ade80",
  "#c084fc",
  "#fbbf24",
  "#f472b6",
  "#22d3ee",
  "#fb923c",
  "#f87171",
  "#2dd4bf"
];
function clampTooltip(tooltip, left, top) {
  tooltip.style.opacity = "0";
  const width = tooltip.offsetWidth || 280;
  const height = tooltip.offsetHeight || 160;
  const margin = 8;
  let nextLeft = left + 14;
  let nextTop = top + 14;
  if (nextLeft + width > window.innerWidth - margin) {
    nextLeft = window.innerWidth - width - margin;
  }
  if (nextLeft < margin) {
    nextLeft = margin;
  }
  if (nextTop + height > window.innerHeight - margin) {
    nextTop = top - height - 14;
  }
  if (nextTop < margin) {
    nextTop = margin;
  }
  tooltip.style.left = `${nextLeft}px`;
  tooltip.style.top = `${nextTop}px`;
  requestAnimationFrame(() => {
    tooltip.style.opacity = "1";
  });
}
function renderTooltip(tooltip, title, subtitle, rows, description) {
  tooltip.textContent = "";
  const titleElement = document.createElement("p");
  titleElement.style.cssText = "font-size:12px;font-weight:600;color:#e2e8f0;margin:0 0 2px";
  titleElement.textContent = title;
  tooltip.appendChild(titleElement);
  const subtitleElement = document.createElement("p");
  subtitleElement.style.cssText = "font-size:10px;color:#64748b;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.05em";
  subtitleElement.textContent = subtitle;
  tooltip.appendChild(subtitleElement);
  for (const row of rows) {
    const rowElement = document.createElement("div");
    rowElement.style.cssText = "display:flex;justify-content:space-between;gap:16px;font-size:11px;line-height:1.6";
    const labelElement = document.createElement("span");
    labelElement.style.color = "#64748b";
    labelElement.textContent = row.label;
    const valueElement = document.createElement("span");
    valueElement.style.cssText = "color:#cbd5e1;font-weight:500;font-variant-numeric:tabular-nums";
    valueElement.textContent = row.value;
    rowElement.appendChild(labelElement);
    rowElement.appendChild(valueElement);
    tooltip.appendChild(rowElement);
  }
  if (description) {
    const descriptionElement = document.createElement("p");
    descriptionElement.style.cssText = "font-size:11px;color:#94a3b8;line-height:1.45;margin:8px 0 0;padding-top:8px;border-top:1px solid #2a2a4a";
    descriptionElement.textContent = description;
    tooltip.appendChild(descriptionElement);
  }
}
function Graph({
  nodes,
  links,
  ariaLabel = "Graph",
  emptyMessage = "No data",
  legendLabel = "Legend",
  edgeLegendLabel = "A runs before B",
  getNodeRows,
  getLinkRows,
  getNodeDescription,
  getLinkDescription
}) {
  const containerRef = (0, import_react.useRef)(null);
  const svgRef = (0, import_react.useRef)(null);
  const tooltipRef = (0, import_react.useRef)(null);
  const simulationRef = (0, import_react.useRef)(
    null
  );
  const graphData = (0, import_react.useMemo)(() => {
    const nodeMap = /* @__PURE__ */ new Map();
    nodes.forEach((node, index) => {
      nodeMap.set(node.id, {
        ...node,
        color: node.color ?? DEFAULT_NODE_COLORS[index % DEFAULT_NODE_COLORS.length],
        strokeColor: node.strokeColor ?? DEFAULT_NODE_STROKES[index % DEFAULT_NODE_STROKES.length]
      });
    });
    const dedupedLinks = [];
    const seen = /* @__PURE__ */ new Set();
    for (const link of links) {
      if (link.source === link.target) {
        continue;
      }
      if (!(nodeMap.has(link.source) && nodeMap.has(link.target))) {
        continue;
      }
      const key = `${link.source}->${link.target}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      dedupedLinks.push({
        ...link,
        label: link.label ?? `${link.weight}x`
      });
    }
    return {
      nodes: [...nodeMap.values()],
      links: dedupedLinks,
      isEmpty: nodeMap.size === 0 || dedupedLinks.length === 0
    };
  }, [links, nodes]);
  (0, import_react.useEffect)(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    const tooltip = tooltipRef.current;
    if (!(svg && container && tooltip) || graphData.isEmpty) {
      return;
    }
    simulationRef.current?.stop();
    const width = container.clientWidth;
    const height = Math.max(440, Math.min(680, width * 0.68));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;
    const root = d3.select(svg);
    root.selectAll("*").remove();
    const defs = root.append("defs");
    defs.append("marker").attr("id", "graph-arrowhead").attr("viewBox", "0 0 10 6").attr("refX", 10).attr("refY", 3).attr("markerWidth", 8).attr("markerHeight", 5).attr("orient", "auto").append("path").attr("d", "M0,0 L10,3 L0,6 Z").attr("fill", "#64748b");
    const simNodes = graphData.nodes.map((node) => ({ ...node }));
    const nodeById = new Map(simNodes.map((node) => [node.id, node]));
    const simLinks = graphData.links.map((link) => ({
      ...link,
      source: nodeById.get(link.source) ?? link.source,
      target: nodeById.get(link.target) ?? link.target
    }));
    const valueExtent = d3.extent(simNodes, (node) => node.value);
    const radiusScale = d3.scaleSqrt().domain([
      Math.max(1, valueExtent[0] ?? 1),
      Math.max(2, valueExtent[1] ?? 2)
    ]).range([22, 46]).clamp(true);
    const weightExtent = d3.extent(simLinks, (link) => link.weight);
    const strokeScale = d3.scaleLinear().domain([
      Math.max(1, weightExtent[0] ?? 1),
      Math.max(2, weightExtent[1] ?? 2)
    ]).range([1.5, 6]).clamp(true);
    const linkGroup = root.append("g");
    const linkElements = linkGroup.selectAll("path").data(simLinks).join("path").attr("fill", "none").attr("stroke", "#64748b").attr("stroke-opacity", 0.55).attr("stroke-width", (link) => Math.max(1.5, strokeScale(link.weight))).attr("marker-end", "url(#graph-arrowhead)");
    const labelGroup = root.append("g");
    const edgeLabels = labelGroup.selectAll("text").data(simLinks).join("text").attr("fill", "#94a3b8").attr("font-size", "9px").attr("font-weight", "600").attr("text-anchor", "middle").text((link) => link.label ?? `${link.weight}x`);
    const hitGroup = root.append("g");
    const hitTargets = hitGroup.selectAll("path").data(simLinks).join("path").attr("fill", "none").attr("stroke", "transparent").attr("stroke-width", 16).attr("cursor", "pointer");
    const nodeGroup = root.append("g");
    const nodeElements = nodeGroup.selectAll("g").data(simNodes).join("g").attr("cursor", "grab");
    nodeElements.append("circle").attr("r", (node) => radiusScale(node.value)).attr("fill", (node) => node.color ?? DEFAULT_NODE_COLORS[0]).attr("fill-opacity", 0.82).attr("stroke", (node) => node.strokeColor ?? DEFAULT_NODE_STROKES[0]).attr("stroke-width", 2);
    nodeElements.append("text").attr("text-anchor", "middle").attr("dy", (node) => radiusScale(node.value) + 14).attr("fill", "#cbd5e1").attr("font-size", "10px").attr("font-weight", "500").text((node) => {
      const label = node.label ?? node.id;
      return label.length > 16 ? `${label.slice(0, 14)}...` : label;
    });
    const hideTooltip = () => {
      tooltip.style.opacity = "0";
    };
    hitTargets.on("mouseenter", (event, link) => {
      const source = link.source;
      const target = link.target;
      linkElements.attr("stroke-opacity", (current) => current === link ? 0.95 : 0.08).attr(
        "stroke-width",
        (current) => current === link ? Math.max(3, strokeScale(current.weight) + 1) : Math.max(1.5, strokeScale(current.weight))
      );
      edgeLabels.attr("fill-opacity", (current) => current === link ? 1 : 0.15);
      renderTooltip(
        tooltip,
        `${source.label ?? source.id} -> ${target.label ?? target.id}`,
        "Link",
        getLinkRows?.(link, source, target) ?? [
          { label: "Pairs", value: `${link.weight}x` },
          { label: "Source volume", value: source.value.toLocaleString() },
          { label: "Target volume", value: target.value.toLocaleString() }
        ],
        getLinkDescription?.(link, source, target)
      );
      clampTooltip(tooltip, event.clientX, event.clientY);
    }).on("mouseleave", () => {
      linkElements.attr("stroke-opacity", 0.55).attr("stroke-width", (link) => Math.max(1.5, strokeScale(link.weight)));
      edgeLabels.attr("fill-opacity", 1);
      hideTooltip();
    });
    nodeElements.on("mouseenter", (event, node) => {
      linkElements.attr("stroke-opacity", (link) => {
        const source = link.source;
        const target = link.target;
        return source.id === node.id || target.id === node.id ? 0.9 : 0.08;
      });
      edgeLabels.attr("fill-opacity", (link) => {
        const source = link.source;
        const target = link.target;
        return source.id === node.id || target.id === node.id ? 1 : 0.15;
      });
      d3.select(event.currentTarget).select("circle").attr("stroke-width", 4);
      renderTooltip(
        tooltip,
        node.label ?? node.id,
        "Node",
        getNodeRows?.(node) ?? [{ label: "Value", value: node.value.toLocaleString() }],
        getNodeDescription?.(node)
      );
      clampTooltip(tooltip, event.clientX, event.clientY);
    }).on("mouseleave", () => {
      linkElements.attr("stroke-opacity", 0.55);
      edgeLabels.attr("fill-opacity", 1);
      nodeElements.selectAll("circle").attr("stroke-width", 2);
      hideTooltip();
    });
    const drag2 = d3.drag().on("start", (event, node) => {
      if (!event.active) {
        simulation.alphaTarget(0.12).restart();
      }
      node.fx = node.x;
      node.fy = node.y;
    }).on("drag", (event, node) => {
      node.fx = event.x;
      node.fy = event.y;
    }).on("end", (event, node) => {
      if (!event.active) {
        simulation.alphaTarget(0);
      }
      node.fx = null;
      node.fy = null;
    });
    nodeElements.call(drag2);
    const simulation = d3.forceSimulation(simNodes).force(
      "link",
      d3.forceLink(simLinks).id((node) => node.id).distance(250)
    ).force("charge", d3.forceManyBody().strength(-800)).force("center", d3.forceCenter(width / 2, height / 2)).force(
      "collision",
      d3.forceCollide().radius(
        (node) => radiusScale(node.value) + 30
      )
    ).force("x", d3.forceX(width / 2).strength(0.03)).force("y", d3.forceY(height / 2).strength(0.03)).alpha(0.5).on("tick", () => {
      for (const node of simNodes) {
        const radius = radiusScale(node.value) + 16;
        node.x = Math.max(radius, Math.min(width - radius, node.x ?? width / 2));
        node.y = Math.max(radius, Math.min(height - radius, node.y ?? height / 2));
      }
      const pathFor = (link) => {
        const source = link.source;
        const target = link.target;
        const sx = source.x ?? 0;
        const sy = source.y ?? 0;
        const tx = target.x ?? 0;
        const ty = target.y ?? 0;
        const dx = tx - sx;
        const dy = ty - sy;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const sourceRadius = radiusScale(source.value);
        const targetRadius = radiusScale(target.value) + 8;
        const x1 = sx + dx / distance * sourceRadius;
        const y1 = sy + dy / distance * sourceRadius;
        const x2 = tx - dx / distance * targetRadius;
        const y2 = ty - dy / distance * targetRadius;
        const mx = (x1 + x2) / 2 - dy * 0.1;
        const my = (y1 + y2) / 2 + dx * 0.1;
        return `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
      };
      linkElements.attr("d", pathFor);
      hitTargets.attr("d", pathFor);
      edgeLabels.each(function(link) {
        const source = link.source;
        const target = link.target;
        const sx = source.x ?? 0;
        const sy = source.y ?? 0;
        const tx = target.x ?? 0;
        const ty = target.y ?? 0;
        const dx = tx - sx;
        const dy = ty - sy;
        d3.select(this).attr("x", (sx + tx) / 2 - dy * 0.1).attr("y", (sy + ty) / 2 + dx * 0.1 - 4);
      });
      nodeElements.attr(
        "transform",
        (node) => `translate(${node.x ?? 0},${node.y ?? 0})`
      );
    });
    simulationRef.current = simulation;
    return () => {
      simulation.stop();
    };
  }, [
    getLinkDescription,
    getLinkRows,
    getNodeDescription,
    getNodeRows,
    graphData.isEmpty,
    graphData.links,
    graphData.nodes
  ]);
  if (graphData.isEmpty) {
    return /* @__PURE__ */ React.createElement("div", { className: "flex min-h-[320px] items-center justify-center text-sm text-muted-foreground" }, emptyMessage);
  }
  return /* @__PURE__ */ React.createElement("div", { className: "relative w-full", ref: containerRef }, /* @__PURE__ */ React.createElement(
    "svg",
    {
      "aria-label": ariaLabel,
      onMouseLeave: () => {
        const tooltip = tooltipRef.current;
        if (tooltip) {
          tooltip.style.opacity = "0";
        }
      },
      ref: svgRef,
      role: "img",
      style: { display: "block", width: "100%", background: "transparent" }
    }
  ), /* @__PURE__ */ React.createElement(
    "div",
    {
      "aria-hidden": "true",
      className: "fixed z-50 rounded-lg border border-[#2a2a4a] bg-[#12121f] px-3 py-2 shadow-2xl pointer-events-none",
      ref: tooltipRef,
      role: "tooltip",
      style: {
        opacity: 0,
        left: 0,
        top: 0,
        minWidth: 172,
        transition: "opacity 120ms ease-out"
      }
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "mt-3 flex flex-wrap items-center gap-3 px-1" }, /* @__PURE__ */ React.createElement("span", { className: "text-[10px] font-medium uppercase tracking-widest text-muted-foreground" }, legendLabel), graphData.nodes.map((node, index) => /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1.5", key: node.id }, /* @__PURE__ */ React.createElement(
    "span",
    {
      className: "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
      style: {
        backgroundColor: node.color ?? DEFAULT_NODE_COLORS[index % DEFAULT_NODE_COLORS.length],
        border: `1.5px solid ${node.strokeColor ?? DEFAULT_NODE_STROKES[index % DEFAULT_NODE_STROKES.length]}`
      }
    }
  ), /* @__PURE__ */ React.createElement("span", { className: "text-[11px] text-muted-foreground" }, node.label ?? node.id))), /* @__PURE__ */ React.createElement("div", { className: "ml-2 flex items-center gap-1.5" }, /* @__PURE__ */ React.createElement("svg", { className: "shrink-0", height: "8", width: "20" }, /* @__PURE__ */ React.createElement("line", { x1: "0", x2: "14", y1: "4", y2: "4", stroke: "#64748b", strokeWidth: "1.5" }), /* @__PURE__ */ React.createElement("polygon", { fill: "#64748b", points: "14,1 20,4 14,7" })), /* @__PURE__ */ React.createElement("span", { className: "text-[11px] text-muted-foreground" }, edgeLegendLabel))));
}

// components/ui/composites/agent-collaboration-network.tsx
function AgentCollaborationNetwork({
  data,
  edges
}) {
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-4",
      description: "Directed workflow handoffs between agent types, with weighted edges and relative node volume.",
      title: "Agent collaboration network"
    },
    /* @__PURE__ */ React.createElement(
      Graph,
      {
        ariaLabel: "Agent collaboration graph",
        edgeLegendLabel: "A runs before B",
        getLinkDescription: (link, source, target) => `${source.label ?? source.id} runs before ${target.label ?? target.id} ${link.weight} times.`,
        getLinkRows: (link, source, target) => [
          { label: "Sequential pairs", value: `${link.weight}x` },
          {
            label: `Share of ${source.label ?? source.id}`,
            value: source.value > 0 ? `${(link.weight / source.value * 100).toFixed(1)}%` : "\u2014"
          },
          {
            label: `Share of ${target.label ?? target.id}`,
            value: target.value > 0 ? `${(link.weight / target.value * 100).toFixed(1)}%` : "\u2014"
          }
        ],
        getNodeDescription: (node) => `${node.label ?? node.id} appears in ${node.value} runs across the observed workflow graph.`,
        getNodeRows: (node) => {
          const item = data.find((entry) => entry.subagentType === node.id);
          return [
            { label: "Runs", value: node.value.toLocaleString() },
            {
              label: "Sessions",
              value: (item?.sessions ?? 0).toLocaleString()
            },
            {
              label: "Success rate",
              value: item ? `${item.successRate.toFixed(0)}%` : "\u2014"
            }
          ];
        },
        legendLabel: "Legend",
        links: edges.map((edge) => ({
          ...edge,
          label: `${edge.weight}x`
        })),
        nodes: data.map((item) => ({
          id: item.subagentType,
          label: item.subagentType,
          value: item.total
        }))
      }
    )
  );
}

// components/ui/composites/agent-pipeline-graph.tsx
function AgentPipelineGraph({
  data,
  edges
}) {
  return /* @__PURE__ */ React.createElement(AgentCollaborationNetwork, { data, edges });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AgentPipelineGraph
});
//# sourceMappingURL=agent-pipeline-graph.js.map