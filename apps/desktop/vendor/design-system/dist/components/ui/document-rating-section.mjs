import React from "react";
"use client";
import {
  StarRating
} from "../../chunk-SDJJIIZU.mjs";
import {
  Skeleton
} from "../../chunk-J6SXEWRG.mjs";
import {
  Textarea
} from "../../chunk-64QT2WSE.mjs";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/document-rating-section.tsx
import { AlertTriangle as AlertTriangleIcon, Loader2Icon } from "lucide-react";
function DocumentRatingSection({
  summary,
  currentDocumentVersion,
  selectedScore,
  commentDraft,
  isLoading = false,
  isSaving = false,
  onScoreChange,
  onCommentChange,
  onCancelComment,
  onSaveComment
}) {
  const userRating = summary?.userRating;
  const hasStaleVersion = userRating && userRating.documentVersion !== currentDocumentVersion;
  const effectiveScore = userRating?.score ?? selectedScore ?? 0;
  const showCommentSection = effectiveScore > 0;
  const commentUnchanged = (userRating?.comment ?? "") === commentDraft;
  if (isLoading) {
    return /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, /* @__PURE__ */ React.createElement(Skeleton, { className: "h-6 w-32" }), /* @__PURE__ */ React.createElement(Skeleton, { className: "h-4 w-48" }));
  }
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement(
    StarRating,
    {
      onChange: onScoreChange,
      readonly: isSaving,
      value: effectiveScore
    }
  ), isSaving ? /* @__PURE__ */ React.createElement(Loader2Icon, { className: "h-4 w-4 animate-spin text-muted-foreground" }) : null), /* @__PURE__ */ React.createElement("div", { "aria-live": "polite", className: "text-center text-sm" }, summary && summary.count > 0 ? /* @__PURE__ */ React.createElement("span", null, summary.average.toFixed(1), " / 5", " ", /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground" }, "(", summary.count, " rating", summary.count === 1 ? "" : "s", ")")) : /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground" }, "No ratings yet. Be the first to rate!")), hasStaleVersion ? /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1.5 rounded-md bg-amber-100 px-2 py-1 text-amber-800 text-xs dark:bg-amber-900 dark:text-amber-200" }, /* @__PURE__ */ React.createElement(AlertTriangleIcon, { className: "h-3 w-3" }), /* @__PURE__ */ React.createElement("span", null, "Rated on version ", userRating.documentVersion, " (current:", " ", currentDocumentVersion, ")")) : null, showCommentSection ? /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement(
    Textarea,
    {
      className: "min-h-[80px]",
      maxLength: 500,
      onChange: (event) => onCommentChange?.(event.target.value),
      placeholder: "Add a comment (optional)",
      value: commentDraft
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-xs" }, commentDraft.length, " / 500"), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2" }, /* @__PURE__ */ React.createElement(
    Button,
    {
      onClick: onCancelComment,
      size: "sm",
      variant: "ghost"
    },
    "Cancel"
  ), /* @__PURE__ */ React.createElement(
    Button,
    {
      disabled: isSaving || effectiveScore <= 0 || commentUnchanged,
      onClick: onSaveComment,
      size: "sm"
    },
    "Save Comment"
  )))) : null);
}
export {
  DocumentRatingSection
};
//# sourceMappingURL=document-rating-section.mjs.map