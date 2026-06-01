var React = require("react");
"use strict";
"use client";
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

// components/ui/status-badge.tsx
var status_badge_exports = {};
__export(status_badge_exports, {
  DocumentStatusBadge: () => DocumentStatusBadge,
  FeaturePriorityBadge: () => FeaturePriorityBadge,
  FeatureStatusBadge: () => FeatureStatusBadge,
  ImplementationPlanStatusBadge: () => ImplementationPlanStatusBadge,
  LoopCommandBadge: () => LoopCommandBadge,
  LoopStatusBadge: () => LoopStatusBadge,
  PrdStatusBadge: () => PrdStatusBadge,
  StatusBadge: () => StatusBadge,
  WorkstreamStateBadge: () => WorkstreamStateBadge,
  WorkstreamTypeBadge: () => WorkstreamTypeBadge,
  artifactStatusColors: () => artifactStatusColors,
  artifactStatusLabels: () => artifactStatusLabels,
  featurePriorityColors: () => featurePriorityColors,
  featurePriorityLabels: () => featurePriorityLabels,
  featureStatusColors: () => featureStatusColors,
  featureStatusLabels: () => featureStatusLabels,
  loopCommandColors: () => loopCommandColors,
  loopErrorCodeColors: () => loopErrorCodeColors,
  loopStatusColors: () => loopStatusColors,
  previewDeploymentStateColors: () => previewDeploymentStateColors,
  workstreamStateColors: () => workstreamStateColors,
  workstreamTypeColors: () => workstreamTypeColors
});
module.exports = __toCommonJS(status_badge_exports);
var import_common = require("@repo/api/src/types/common");
var import_document = require("@repo/api/src/types/document");
var import_friendly_error = require("@repo/api/src/types/friendly-error");
var import_loop = require("@repo/api/src/types/loop");

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

// components/ui/status-badge.tsx
function StatusBadge({
  status,
  colorMap,
  defaultStyle,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    Badge,
    {
      className: cn(
        "font-medium",
        colorMap[status] ?? defaultStyle ?? colorMap[Object.keys(colorMap)[0]],
        className
      ),
      variant: "outline"
    },
    status
  );
}
var COLOR_SUCCESS = "bg-success/10 text-success-foreground border-success/30";
var COLOR_FAILURE = "bg-destructive/10 text-destructive border-destructive/30";
var COLOR_PROGRESS = "bg-info/10 text-info-foreground border-info/30";
var COLOR_PENDING = "bg-warning/10 text-warning-foreground border-warning/30";
var COLOR_INACTIVE = "bg-muted text-muted-foreground border-muted";
var COLOR_AI = "bg-ai/10 text-ai-foreground border-ai/30";
var previewDeploymentStateColors = {
  READY: COLOR_SUCCESS,
  SUCCESS: COLOR_SUCCESS,
  IN_PROGRESS: COLOR_PROGRESS,
  BUILDING: COLOR_PROGRESS,
  PENDING: COLOR_PENDING,
  QUEUED: COLOR_PENDING,
  INACTIVE: COLOR_INACTIVE,
  FAILURE: COLOR_FAILURE,
  ERROR: COLOR_FAILURE
};
var artifactStatusColors = {
  [import_document.DocumentStatus.Draft]: "bg-muted text-muted-foreground border-muted",
  [import_document.DocumentStatus.InProgress]: COLOR_PROGRESS,
  [import_document.DocumentStatus.InReview]: COLOR_PROGRESS,
  [import_document.DocumentStatus.Approved]: COLOR_PROGRESS,
  [import_document.DocumentStatus.Executed]: COLOR_PROGRESS,
  [import_document.DocumentStatus.Done]: COLOR_SUCCESS,
  [import_document.DocumentStatus.Obsolete]: COLOR_INACTIVE
};
var artifactStatusLabels = {
  [import_document.DocumentStatus.Draft]: "Draft",
  [import_document.DocumentStatus.InProgress]: "In Progress",
  [import_document.DocumentStatus.InReview]: "In Review",
  [import_document.DocumentStatus.Approved]: "Approved",
  [import_document.DocumentStatus.Executed]: "Executed",
  [import_document.DocumentStatus.Done]: "Done",
  [import_document.DocumentStatus.Obsolete]: "Obsolete"
};
function DocumentStatusBadge({
  status
}) {
  const displayStatus = artifactStatusLabels[status] ?? status;
  return /* @__PURE__ */ React.createElement(
    Badge,
    {
      className: cn(
        "font-medium",
        artifactStatusColors[status] ?? artifactStatusColors[import_document.DocumentStatus.Draft]
      ),
      variant: "outline"
    },
    displayStatus
  );
}
var PrdStatusBadge = DocumentStatusBadge;
var ImplementationPlanStatusBadge = DocumentStatusBadge;
var featureStatusColors = artifactStatusColors;
var featureStatusLabels = artifactStatusLabels;
var FeatureStatusBadge = DocumentStatusBadge;
var featurePriorityColors = {
  [import_common.Priority.Low]: COLOR_PROGRESS,
  [import_common.Priority.Medium]: COLOR_PENDING,
  [import_common.Priority.High]: COLOR_FAILURE,
  [import_common.Priority.Urgent]: COLOR_FAILURE
};
var featurePriorityLabels = {
  [import_common.Priority.Low]: "Low",
  [import_common.Priority.Medium]: "Medium",
  [import_common.Priority.High]: "High",
  [import_common.Priority.Urgent]: "Urgent"
};
function FeaturePriorityBadge({
  priority
}) {
  const displayPriority = featurePriorityLabels[priority] ?? priority;
  return /* @__PURE__ */ React.createElement(
    Badge,
    {
      className: cn(
        "font-medium",
        featurePriorityColors[priority] ?? featurePriorityColors[import_common.Priority.Low]
      ),
      variant: "outline"
    },
    displayPriority
  );
}
var workstreamStateColors = {
  INITIATED: COLOR_PROGRESS,
  REQUIREMENTS_GENERATING: COLOR_AI,
  REQUIREMENTS_PENDING_APPROVAL: COLOR_PENDING,
  DESIGN_IN_PROGRESS: COLOR_AI,
  DESIGN_PENDING_APPROVAL: COLOR_PENDING,
  IMPLEMENTATION_PLANNING: COLOR_AI,
  IMPLEMENTATION_IN_PROGRESS: COLOR_PROGRESS,
  IMPLEMENTATION_PENDING_REVIEW: COLOR_PENDING,
  CODE_REVIEW_RUNNING: COLOR_AI,
  CODE_REVIEW_PENDING_APPROVAL: COLOR_PENDING,
  VISUAL_QA_RUNNING: COLOR_AI,
  VISUAL_QA_PENDING_APPROVAL: COLOR_PENDING,
  MERGING: COLOR_PROGRESS,
  DEPLOYED: COLOR_SUCCESS,
  COMPLETED: COLOR_SUCCESS,
  BLOCKED: COLOR_FAILURE,
  CANCELLED: COLOR_INACTIVE
};
var workstreamStateLabels = {
  INITIATED: "Initiated",
  REQUIREMENTS_GENERATING: "Generating",
  REQUIREMENTS_PENDING_APPROVAL: "Pending Approval",
  DESIGN_IN_PROGRESS: "In Progress",
  DESIGN_PENDING_APPROVAL: "Pending Approval",
  IMPLEMENTATION_PLANNING: "Planning",
  IMPLEMENTATION_IN_PROGRESS: "In Progress",
  IMPLEMENTATION_PENDING_REVIEW: "Pending Review",
  CODE_REVIEW_RUNNING: "Running",
  CODE_REVIEW_PENDING_APPROVAL: "Pending Approval",
  VISUAL_QA_RUNNING: "Running",
  VISUAL_QA_PENDING_APPROVAL: "Pending Approval",
  MERGING: "Merging",
  DEPLOYED: "Deployed",
  COMPLETED: "Completed",
  BLOCKED: "Blocked",
  CANCELLED: "Cancelled"
};
function WorkstreamStateBadge({
  state
}) {
  const displayState = workstreamStateLabels[state] ?? state;
  return /* @__PURE__ */ React.createElement(
    Badge,
    {
      className: cn(
        "font-medium",
        workstreamStateColors[state] ?? workstreamStateColors.INITIATED
      ),
      variant: "outline"
    },
    displayState
  );
}
var workstreamTypeColors = {
  FEATURE_DELIVERY: COLOR_PROGRESS,
  BUG_FIX: COLOR_FAILURE,
  TECH_DEBT: COLOR_PENDING,
  SPIKE: COLOR_AI
};
var workstreamTypeLabels = {
  FEATURE_DELIVERY: "Feature",
  BUG_FIX: "Bug Fix",
  TECH_DEBT: "Tech Debt",
  SPIKE: "Spike"
};
function WorkstreamTypeBadge({
  type
}) {
  const displayType = workstreamTypeLabels[type] ?? type;
  return /* @__PURE__ */ React.createElement(
    Badge,
    {
      className: cn(
        "font-medium",
        workstreamTypeColors[type] ?? workstreamTypeColors.FEATURE_DELIVERY
      ),
      variant: "outline"
    },
    displayType
  );
}
var loopStatusColors = {
  [import_loop.LoopStatus.Pending]: COLOR_PENDING,
  [import_loop.LoopStatus.Claimed]: COLOR_PENDING,
  [import_loop.LoopStatus.Running]: COLOR_PROGRESS,
  [import_loop.LoopStatus.Completed]: COLOR_SUCCESS,
  [import_loop.LoopStatus.Failed]: COLOR_FAILURE,
  [import_loop.LoopStatus.Cancelled]: COLOR_INACTIVE,
  [import_loop.LoopStatus.TimedOut]: COLOR_FAILURE
};
var loopStatusLabels = {
  [import_loop.LoopStatus.Pending]: "Pending",
  [import_loop.LoopStatus.Claimed]: "Claimed",
  [import_loop.LoopStatus.Running]: "Running",
  [import_loop.LoopStatus.Completed]: "Completed",
  [import_loop.LoopStatus.Failed]: "Failed",
  [import_loop.LoopStatus.Cancelled]: "Cancelled",
  [import_loop.LoopStatus.TimedOut]: "Timed Out"
};
var loopErrorCodeColors = {
  [import_loop.LoopErrorCode.NoWorkProduced]: COLOR_PENDING,
  [import_loop.LoopErrorCode.ContextLimitExceeded]: COLOR_FAILURE,
  [import_loop.LoopErrorCode.PlanStateUnavailable]: COLOR_FAILURE,
  [import_loop.LoopErrorCode.StaleDispatch]: COLOR_FAILURE,
  [import_loop.LoopErrorCode.RunnerError]: COLOR_FAILURE
};
function LoopStatusBadge({
  status,
  errorCode,
  ghostLoopUx = false
}) {
  const showErrorCode = ghostLoopUx && status === import_loop.LoopStatus.Failed && errorCode !== void 0;
  const friendlyErrorCode = showErrorCode ? errorCode : void 0;
  const displayStatus = friendlyErrorCode ? (0, import_friendly_error.resolveFriendlyError)({ code: friendlyErrorCode }).title : loopStatusLabels[status] ?? status;
  const colorClass = friendlyErrorCode ? loopErrorCodeColors[friendlyErrorCode] ?? loopStatusColors[import_loop.LoopStatus.Failed] : loopStatusColors[status] ?? loopStatusColors[import_loop.LoopStatus.Pending];
  return /* @__PURE__ */ React.createElement(Badge, { className: cn("font-medium", colorClass), variant: "outline" }, displayStatus);
}
var loopCommandColors = {
  [import_loop.LoopCommand.Plan]: COLOR_AI,
  [import_loop.LoopCommand.Execute]: COLOR_PROGRESS,
  [import_loop.LoopCommand.Chat]: COLOR_PENDING,
  [import_loop.LoopCommand.Explore]: COLOR_AI,
  [import_loop.LoopCommand.RequestChanges]: COLOR_PENDING,
  [import_loop.LoopCommand.RequestPrdChanges]: COLOR_PENDING,
  [import_loop.LoopCommand.Decompose]: COLOR_AI,
  [import_loop.LoopCommand.EvaluatePrd]: COLOR_AI,
  [import_loop.LoopCommand.GeneratePrd]: COLOR_AI,
  [import_loop.LoopCommand.EvaluatePlan]: COLOR_AI,
  [import_loop.LoopCommand.EvaluateCode]: COLOR_AI,
  [import_loop.LoopCommand.EvaluateFeature]: COLOR_AI,
  [import_loop.LoopCommand.Bootstrap]: COLOR_AI,
  [import_loop.LoopCommand.Manual]: COLOR_PENDING
};
var loopCommandLabels = {
  [import_loop.LoopCommand.Plan]: "Plan",
  [import_loop.LoopCommand.Execute]: "Execute",
  [import_loop.LoopCommand.Chat]: "Chat",
  [import_loop.LoopCommand.Explore]: "Explore",
  [import_loop.LoopCommand.RequestChanges]: "Request Changes",
  [import_loop.LoopCommand.RequestPrdChanges]: "Request PRD Changes",
  [import_loop.LoopCommand.Decompose]: "Decompose",
  [import_loop.LoopCommand.EvaluatePrd]: "Evaluate PRD",
  [import_loop.LoopCommand.GeneratePrd]: "Generate PRD",
  [import_loop.LoopCommand.EvaluatePlan]: "Evaluate Plan",
  [import_loop.LoopCommand.EvaluateCode]: "Evaluate PR",
  [import_loop.LoopCommand.EvaluateFeature]: "Evaluate Feature",
  [import_loop.LoopCommand.Bootstrap]: "Bootstrap",
  [import_loop.LoopCommand.Manual]: "Manual"
};
function LoopCommandBadge({
  command
}) {
  const displayCommand = loopCommandLabels[command] ?? command;
  return /* @__PURE__ */ React.createElement(
    Badge,
    {
      className: cn(
        "font-medium",
        loopCommandColors[command] ?? loopCommandColors[import_loop.LoopCommand.Execute]
      ),
      variant: "outline"
    },
    displayCommand
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DocumentStatusBadge,
  FeaturePriorityBadge,
  FeatureStatusBadge,
  ImplementationPlanStatusBadge,
  LoopCommandBadge,
  LoopStatusBadge,
  PrdStatusBadge,
  StatusBadge,
  WorkstreamStateBadge,
  WorkstreamTypeBadge,
  artifactStatusColors,
  artifactStatusLabels,
  featurePriorityColors,
  featurePriorityLabels,
  featureStatusColors,
  featureStatusLabels,
  loopCommandColors,
  loopErrorCodeColors,
  loopStatusColors,
  previewDeploymentStateColors,
  workstreamStateColors,
  workstreamTypeColors
});
//# sourceMappingURL=status-badge.js.map