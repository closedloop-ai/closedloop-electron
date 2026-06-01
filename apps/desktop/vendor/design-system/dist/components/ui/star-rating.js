var React = require("react");
"use strict";
"use client";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// components/ui/star-rating.tsx
var star_rating_exports = {};
__export(star_rating_exports, {
  StarRating: () => StarRating
});
module.exports = __toCommonJS(star_rating_exports);

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StarRating
});
//# sourceMappingURL=star-rating.js.map