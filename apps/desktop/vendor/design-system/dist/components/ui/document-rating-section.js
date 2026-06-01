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

// components/ui/document-rating-section.tsx
var document_rating_section_exports = {};
__export(document_rating_section_exports, {
  DocumentRatingSection: () => DocumentRatingSection
});
module.exports = __toCommonJS(document_rating_section_exports);
var import_lucide_react2 = require("lucide-react");

// components/ui/button.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/button.tsx
var buttonVariants = (0, import_class_variance_authority.cva)(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline: "border border-input-border bg-input hover:bg-muted hover:text-foreground dark:bg-input dark:hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4 gap-2 py-2 has-[>svg]:px-3 [&_svg:not([class*='size-'])]:size-4",
        sm: "h-8 rounded-md gap-2 px-3 has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 rounded-md gap-2 px-6 has-[>svg]:px-4 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-9 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-4"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);
function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? import_radix_ui.Slot.Slot : "button";
  return /* @__PURE__ */ React2.createElement(
    Comp,
    {
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size, className })),
      ...props
    }
  );
}

// components/ui/skeleton.tsx
function Skeleton({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "skeleton",
      className: cn("bg-accent animate-pulse rounded-md", className),
      ...props
    }
  );
}

// components/ui/star-rating.tsx
var import_lucide_react = require("lucide-react");
var import_react = require("react");
var sizeMap = {
  sm: "h-4 w-4",
  default: "h-5 w-5",
  lg: "h-6 w-6"
};
function StarRating({
  value,
  onChange,
  size = "default",
  readonly = false
}) {
  const clampedValue = Math.max(0, Math.min(5, value));
  const [hoveredIndex, setHoveredIndex] = (0, import_react.useState)(null);
  const [focusedIndex, setFocusedIndex] = (0, import_react.useState)(null);
  const isInteractive = Boolean(onChange && !readonly);
  const handleStarClick = (index) => {
    if (isInteractive && onChange) {
      onChange(index);
    }
  };
  const handleKeyDown = (event) => {
    if (!(isInteractive && onChange)) {
      return;
    }
    const currentIndex = focusedIndex ?? clampedValue;
    switch (event.key) {
      case "ArrowLeft": {
        event.preventDefault();
        const newValue = Math.max(0, currentIndex - 1);
        setFocusedIndex(newValue);
        onChange(newValue);
        break;
      }
      case "ArrowRight": {
        event.preventDefault();
        const newValue = Math.min(5, currentIndex + 1);
        setFocusedIndex(newValue);
        onChange(newValue);
        break;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        if (focusedIndex !== null) {
          onChange(focusedIndex);
        }
        break;
      }
      default:
        break;
    }
  };
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "aria-label": "Rate 1 to 5 stars",
      className: cn(
        "inline-flex items-center gap-1",
        isInteractive && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      ),
      onKeyDown: handleKeyDown,
      onMouseLeave: () => setHoveredIndex(null),
      role: "radiogroup",
      tabIndex: isInteractive ? 0 : -1
    },
    [1, 2, 3, 4, 5].map((index) => {
      const isFilled = index <= clampedValue;
      const isHovered = hoveredIndex !== null && index <= hoveredIndex;
      const showHoverPreview = isHovered && isInteractive;
      return /* @__PURE__ */ React.createElement(
        import_lucide_react.Star,
        {
          "aria-checked": isFilled,
          className: cn(
            sizeMap[size],
            "transition-all",
            isFilled ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground",
            showHoverPreview && "opacity-70",
            isInteractive ? "cursor-pointer" : "cursor-default"
          ),
          key: index,
          onClick: () => handleStarClick(index),
          onMouseEnter: () => isInteractive && setHoveredIndex(index),
          role: "radio"
        }
      );
    })
  );
}

// components/ui/textarea.tsx
var React3 = __toESM(require("react"));
function Textarea({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "textarea",
    {
      "data-slot": "textarea",
      className: cn(
        "border-input-border placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-input dark:bg-input flex field-sizing-content min-h-16 w-full rounded-md border px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      ),
      ...props
    }
  );
}

// components/ui/document-rating-section.tsx
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
  ), isSaving ? /* @__PURE__ */ React.createElement(import_lucide_react2.Loader2Icon, { className: "h-4 w-4 animate-spin text-muted-foreground" }) : null), /* @__PURE__ */ React.createElement("div", { "aria-live": "polite", className: "text-center text-sm" }, summary && summary.count > 0 ? /* @__PURE__ */ React.createElement("span", null, summary.average.toFixed(1), " / 5", " ", /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground" }, "(", summary.count, " rating", summary.count === 1 ? "" : "s", ")")) : /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground" }, "No ratings yet. Be the first to rate!")), hasStaleVersion ? /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1.5 rounded-md bg-amber-100 px-2 py-1 text-amber-800 text-xs dark:bg-amber-900 dark:text-amber-200" }, /* @__PURE__ */ React.createElement(import_lucide_react2.AlertTriangle, { className: "h-3 w-3" }), /* @__PURE__ */ React.createElement("span", null, "Rated on version ", userRating.documentVersion, " (current:", " ", currentDocumentVersion, ")")) : null, showCommentSection ? /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement(
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DocumentRatingSection
});
//# sourceMappingURL=document-rating-section.js.map