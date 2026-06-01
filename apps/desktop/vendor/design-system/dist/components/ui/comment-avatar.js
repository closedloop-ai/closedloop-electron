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

// components/ui/comment-avatar.tsx
var comment_avatar_exports = {};
__export(comment_avatar_exports, {
  CommentAvatar: () => CommentAvatar,
  getCommentAuthorInitials: () => getCommentAuthorInitials
});
module.exports = __toCommonJS(comment_avatar_exports);

// components/ui/avatar.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/avatar.tsx
function Avatar({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.Avatar.Root,
    {
      "data-slot": "avatar",
      className: cn(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        className
      ),
      ...props
    }
  );
}
function AvatarImage({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.Avatar.Image,
    {
      "data-slot": "avatar-image",
      className: cn("aspect-square size-full", className),
      ...props
    }
  );
}
function AvatarFallback({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.Avatar.Fallback,
    {
      "data-slot": "avatar-fallback",
      className: cn(
        "bg-muted flex size-full items-center justify-center rounded-full",
        className
      ),
      ...props
    }
  );
}

// components/ui/comment-avatar.tsx
var import_lucide_react = require("lucide-react");
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
      /* @__PURE__ */ React.createElement(import_lucide_react.Bot, { "aria-hidden": true, className: AVATAR_ICON_CLASS_NAME[size] })
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CommentAvatar,
  getCommentAuthorInitials
});
//# sourceMappingURL=comment-avatar.js.map