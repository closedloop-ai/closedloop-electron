import React from "react";
"use client";
import {
  Badge
} from "../../chunk-3I7NW6GS.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/status-badge.tsx
import { Priority } from "@repo/api/src/types/common";
import { DocumentStatus } from "@repo/api/src/types/document";
import { resolveFriendlyError } from "@repo/api/src/types/friendly-error";
import { LoopCommand, LoopErrorCode, LoopStatus } from "@repo/api/src/types/loop";
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
  [DocumentStatus.Draft]: "bg-muted text-muted-foreground border-muted",
  [DocumentStatus.InProgress]: COLOR_PROGRESS,
  [DocumentStatus.InReview]: COLOR_PROGRESS,
  [DocumentStatus.Approved]: COLOR_PROGRESS,
  [DocumentStatus.Executed]: COLOR_PROGRESS,
  [DocumentStatus.Done]: COLOR_SUCCESS,
  [DocumentStatus.Obsolete]: COLOR_INACTIVE
};
var artifactStatusLabels = {
  [DocumentStatus.Draft]: "Draft",
  [DocumentStatus.InProgress]: "In Progress",
  [DocumentStatus.InReview]: "In Review",
  [DocumentStatus.Approved]: "Approved",
  [DocumentStatus.Executed]: "Executed",
  [DocumentStatus.Done]: "Done",
  [DocumentStatus.Obsolete]: "Obsolete"
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
        artifactStatusColors[status] ?? artifactStatusColors[DocumentStatus.Draft]
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
  [Priority.Low]: COLOR_PROGRESS,
  [Priority.Medium]: COLOR_PENDING,
  [Priority.High]: COLOR_FAILURE,
  [Priority.Urgent]: COLOR_FAILURE
};
var featurePriorityLabels = {
  [Priority.Low]: "Low",
  [Priority.Medium]: "Medium",
  [Priority.High]: "High",
  [Priority.Urgent]: "Urgent"
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
        featurePriorityColors[priority] ?? featurePriorityColors[Priority.Low]
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
  [LoopStatus.Pending]: COLOR_PENDING,
  [LoopStatus.Claimed]: COLOR_PENDING,
  [LoopStatus.Running]: COLOR_PROGRESS,
  [LoopStatus.Completed]: COLOR_SUCCESS,
  [LoopStatus.Failed]: COLOR_FAILURE,
  [LoopStatus.Cancelled]: COLOR_INACTIVE,
  [LoopStatus.TimedOut]: COLOR_FAILURE
};
var loopStatusLabels = {
  [LoopStatus.Pending]: "Pending",
  [LoopStatus.Claimed]: "Claimed",
  [LoopStatus.Running]: "Running",
  [LoopStatus.Completed]: "Completed",
  [LoopStatus.Failed]: "Failed",
  [LoopStatus.Cancelled]: "Cancelled",
  [LoopStatus.TimedOut]: "Timed Out"
};
var loopErrorCodeColors = {
  [LoopErrorCode.NoWorkProduced]: COLOR_PENDING,
  [LoopErrorCode.ContextLimitExceeded]: COLOR_FAILURE,
  [LoopErrorCode.PlanStateUnavailable]: COLOR_FAILURE,
  [LoopErrorCode.StaleDispatch]: COLOR_FAILURE,
  [LoopErrorCode.RunnerError]: COLOR_FAILURE
};
function LoopStatusBadge({
  status,
  errorCode,
  ghostLoopUx = false
}) {
  const showErrorCode = ghostLoopUx && status === LoopStatus.Failed && errorCode !== void 0;
  const friendlyErrorCode = showErrorCode ? errorCode : void 0;
  const displayStatus = friendlyErrorCode ? resolveFriendlyError({ code: friendlyErrorCode }).title : loopStatusLabels[status] ?? status;
  const colorClass = friendlyErrorCode ? loopErrorCodeColors[friendlyErrorCode] ?? loopStatusColors[LoopStatus.Failed] : loopStatusColors[status] ?? loopStatusColors[LoopStatus.Pending];
  return /* @__PURE__ */ React.createElement(Badge, { className: cn("font-medium", colorClass), variant: "outline" }, displayStatus);
}
var loopCommandColors = {
  [LoopCommand.Plan]: COLOR_AI,
  [LoopCommand.Execute]: COLOR_PROGRESS,
  [LoopCommand.Chat]: COLOR_PENDING,
  [LoopCommand.Explore]: COLOR_AI,
  [LoopCommand.RequestChanges]: COLOR_PENDING,
  [LoopCommand.RequestPrdChanges]: COLOR_PENDING,
  [LoopCommand.Decompose]: COLOR_AI,
  [LoopCommand.EvaluatePrd]: COLOR_AI,
  [LoopCommand.GeneratePrd]: COLOR_AI,
  [LoopCommand.EvaluatePlan]: COLOR_AI,
  [LoopCommand.EvaluateCode]: COLOR_AI,
  [LoopCommand.EvaluateFeature]: COLOR_AI,
  [LoopCommand.Bootstrap]: COLOR_AI,
  [LoopCommand.Manual]: COLOR_PENDING
};
var loopCommandLabels = {
  [LoopCommand.Plan]: "Plan",
  [LoopCommand.Execute]: "Execute",
  [LoopCommand.Chat]: "Chat",
  [LoopCommand.Explore]: "Explore",
  [LoopCommand.RequestChanges]: "Request Changes",
  [LoopCommand.RequestPrdChanges]: "Request PRD Changes",
  [LoopCommand.Decompose]: "Decompose",
  [LoopCommand.EvaluatePrd]: "Evaluate PRD",
  [LoopCommand.GeneratePrd]: "Generate PRD",
  [LoopCommand.EvaluatePlan]: "Evaluate Plan",
  [LoopCommand.EvaluateCode]: "Evaluate PR",
  [LoopCommand.EvaluateFeature]: "Evaluate Feature",
  [LoopCommand.Bootstrap]: "Bootstrap",
  [LoopCommand.Manual]: "Manual"
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
        loopCommandColors[command] ?? loopCommandColors[LoopCommand.Execute]
      ),
      variant: "outline"
    },
    displayCommand
  );
}
export {
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
};
//# sourceMappingURL=status-badge.mjs.map