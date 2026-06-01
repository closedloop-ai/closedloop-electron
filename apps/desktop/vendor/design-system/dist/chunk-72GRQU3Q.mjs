import React from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage
} from "./chunk-ZI7L5RNU.mjs";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/comment-avatar.tsx
import { Bot } from "lucide-react";
var AVATAR_BOX_CLASS_NAME = {
  md: "h-8 w-8",
  sm: "h-7 w-7",
  xs: "h-5 w-5"
};
var AVATAR_ICON_CLASS_NAME = {
  md: "h-4 w-4",
  sm: "h-3.5 w-3.5",
  xs: "h-3 w-3"
};
var AVATAR_FALLBACK_CLASS_NAME = {
  md: "text-xs",
  sm: "text-[10px]",
  xs: "text-[9px]"
};
function getCommentAuthorInitials(author) {
  return author.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}
function CommentAvatar({
  author,
  authorAvatar,
  authorKind,
  size = "md"
}) {
  const box = AVATAR_BOX_CLASS_NAME[size];
  if (authorKind === "bot") {
    return /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-chart-5/15 text-chart-5",
          box
        )
      },
      /* @__PURE__ */ React.createElement(Bot, { "aria-hidden": true, className: AVATAR_ICON_CLASS_NAME[size] })
    );
  }
  return /* @__PURE__ */ React.createElement("span", { className: cn("flex shrink-0 overflow-hidden rounded-[8px]", box) }, /* @__PURE__ */ React.createElement(Avatar, { className: cn("rounded-none", box) }, authorAvatar ? /* @__PURE__ */ React.createElement(
    AvatarImage,
    {
      alt: author,
      className: "object-cover",
      src: authorAvatar
    }
  ) : null, /* @__PURE__ */ React.createElement(
    AvatarFallback,
    {
      className: cn("rounded-none", AVATAR_FALLBACK_CLASS_NAME[size])
    },
    getCommentAuthorInitials(author)
  )));
}

export {
  getCommentAuthorInitials,
  CommentAvatar
};
//# sourceMappingURL=chunk-72GRQU3Q.mjs.map