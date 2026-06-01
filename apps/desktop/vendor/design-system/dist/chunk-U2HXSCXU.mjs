import {
  CENTER,
  CIRCUMFERENCE,
  FilledCheckCircle,
  FilledXCircle,
  INNER_CIRCUMFERENCE,
  INNER_PATH_RADIUS,
  INNER_STROKE_WIDTH,
  RADIUS,
  STROKE_WIDTH
} from "./chunk-TQBNQE2F.mjs";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/status-icon.tsx
import * as React from "react";
var STATUS_LABELS = {
  backlog: "Backlog",
  todo: "To do",
  started: "In Progress",
  "in-progress": "In progress",
  "in-review": "In review",
  executed: "Executed",
  complete: "Complete",
  "wont-do": "Won't do",
  decorative: "Status"
};
function getStatusConfig(status) {
  switch (status) {
    case "backlog": {
      return { percentage: 0, color: "var(--progress)", dashed: true, filled: false, icon: null };
    }
    case "todo": {
      return { percentage: 0, color: "var(--progress)", dashed: false, filled: false, icon: null };
    }
    case "started": {
      return { percentage: 25, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "in-progress": {
      return { percentage: 48.5, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "in-review": {
      return { percentage: 73.5, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "executed": {
      return { percentage: 100, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "complete": {
      return { percentage: 100, color: "var(--success)", dashed: false, filled: true, icon: "check" };
    }
    case "wont-do": {
      return { percentage: 100, color: "var(--foreground)", dashed: false, filled: true, icon: "x" };
    }
    default: {
      return { percentage: 48.5, color: "var(--muted-foreground)", dashed: false, filled: false, icon: null, trackColor: "var(--muted-foreground)", strokeWidth: 1.5 };
    }
  }
}
function StatusIcon({
  status,
  size = 16,
  thinking = false,
  className,
  ...props
}) {
  const config = getStatusConfig(status);
  const defaultLabel = STATUS_LABELS[status];
  if (config.filled) {
    return /* @__PURE__ */ React.createElement(
      "svg",
      {
        role: "img",
        "aria-label": defaultLabel,
        "data-slot": "status-icon",
        width: size,
        height: size,
        viewBox: "0 0 20 20",
        fill: "none",
        className: cn("shrink-0", className),
        ...props
      },
      config.icon === "check" && /* @__PURE__ */ React.createElement(FilledCheckCircle, { fill: config.color }),
      config.icon === "x" && /* @__PURE__ */ React.createElement(FilledXCircle, { fill: config.color })
    );
  }
  const sw = config.strokeWidth ?? STROKE_WIDTH;
  const outerOffset = CIRCUMFERENCE * (1 - config.percentage / 100);
  const innerOffset = INNER_CIRCUMFERENCE * (1 - config.percentage / 100);
  const spinnerDash = CIRCUMFERENCE * 0.25;
  const spinnerGap = CIRCUMFERENCE - spinnerDash;
  const hasArc = config.percentage > 0;
  return /* @__PURE__ */ React.createElement(
    "svg",
    {
      role: "img",
      "aria-label": defaultLabel,
      "data-slot": "status-icon",
      width: size,
      height: size,
      viewBox: "0 0 20 20",
      fill: "none",
      className: cn("shrink-0", className),
      ...props
    },
    /* @__PURE__ */ React.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: config.trackColor ?? "var(--progress)",
        strokeWidth: sw,
        fill: "none",
        strokeDasharray: config.dashed ? "3 3" : void 0
      }
    ),
    !thinking && hasArc && /* @__PURE__ */ React.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: config.color,
        strokeWidth: sw,
        strokeLinecap: "round",
        fill: "none",
        strokeDasharray: CIRCUMFERENCE,
        strokeDashoffset: outerOffset,
        transform: `rotate(-90 ${CENTER} ${CENTER})`,
        className: "transition-all duration-300 ease-in-out"
      }
    ),
    thinking && /* @__PURE__ */ React.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: "var(--thinking)",
        strokeWidth: sw,
        strokeLinecap: "round",
        fill: "none",
        strokeDasharray: `${spinnerDash} ${spinnerGap}`,
        className: "animate-spin origin-center"
      }
    ),
    hasArc && /* @__PURE__ */ React.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: INNER_PATH_RADIUS,
        stroke: config.color,
        strokeWidth: INNER_STROKE_WIDTH,
        fill: "none",
        strokeDasharray: INNER_CIRCUMFERENCE,
        strokeDashoffset: innerOffset,
        transform: `rotate(-90 ${CENTER} ${CENTER})`,
        className: "transition-all duration-300 ease-in-out"
      }
    )
  );
}

export {
  StatusIcon
};
//# sourceMappingURL=chunk-U2HXSCXU.mjs.map