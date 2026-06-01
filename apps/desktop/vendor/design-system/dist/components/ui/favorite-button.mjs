import React from "react";
"use client";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../chunk-MRSDI6D5.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/favorite-button.tsx
import { StarIcon } from "lucide-react";
function FavoriteButton({
  isFavorite,
  isPending = false,
  size = "sm",
  onToggle,
  addLabel = "Add to favorites",
  removeLabel = "Remove from favorites"
}) {
  const label = isFavorite ? removeLabel : addLabel;
  return /* @__PURE__ */ React.createElement(Tooltip, null, /* @__PURE__ */ React.createElement(TooltipTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(
    Button,
    {
      "aria-label": label,
      disabled: isPending,
      onClick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle?.(!isFavorite);
      },
      size: size === "sm" ? "icon-sm" : "icon",
      variant: "ghost"
    },
    /* @__PURE__ */ React.createElement(
      StarIcon,
      {
        className: cn(
          "h-4 w-4",
          isFavorite && "fill-yellow-400 text-yellow-400"
        )
      }
    )
  )), /* @__PURE__ */ React.createElement(TooltipContent, null, label));
}
export {
  FavoriteButton
};
//# sourceMappingURL=favorite-button.mjs.map