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

// components/ui/comments-section.tsx
var comments_section_exports = {};
__export(comments_section_exports, {
  CommentsSection: () => CommentsSection
});
module.exports = __toCommonJS(comments_section_exports);

// components/ui/section-header.tsx
var import_lucide_react = require("lucide-react");
function SectionHeader({
  title,
  children,
  isOpen,
  onToggle
}) {
  const showToggle = onToggle !== void 0 && isOpen !== void 0;
  return /* @__PURE__ */ React.createElement("div", { className: "flex h-12 items-center gap-2 border-b py-2" }, showToggle ? /* @__PURE__ */ React.createElement(
    "button",
    {
      "aria-expanded": isOpen,
      className: "flex shrink-0 items-center gap-2",
      onClick: onToggle,
      type: "button"
    },
    /* @__PURE__ */ React.createElement("span", { className: "font-semibold text-lg" }, title),
    isOpen ? /* @__PURE__ */ React.createElement(import_lucide_react.ChevronDownIcon, { className: "h-4 w-4" }) : /* @__PURE__ */ React.createElement(import_lucide_react.ChevronRightIcon, { className: "h-4 w-4" })
  ) : /* @__PURE__ */ React.createElement("span", { className: "shrink-0 font-semibold text-lg" }, title), /* @__PURE__ */ React.createElement("div", { className: "min-w-0 flex-1" }), children ? /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 items-center gap-2" }, children) : null);
}

// components/ui/collapsible-section.tsx
function CollapsibleSection({
  title,
  open,
  onOpenChange,
  children,
  contentClassName = "space-y-4 pt-3 pb-3"
}) {
  return /* @__PURE__ */ React.createElement("div", { className: "bg-background" }, /* @__PURE__ */ React.createElement(
    SectionHeader,
    {
      isOpen: open,
      onToggle: () => onOpenChange(!open),
      title
    }
  ), open ? /* @__PURE__ */ React.createElement("div", { className: contentClassName }, children) : null);
}

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
var import_lucide_react2 = require("lucide-react");
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
      /* @__PURE__ */ React.createElement(import_lucide_react2.Bot, { "aria-hidden": true, className: AVATAR_ICON_CLASS_NAME[size] })
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

// components/ui/button.tsx
var React3 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");
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
  const Comp = asChild ? import_radix_ui2.Slot.Slot : "button";
  return /* @__PURE__ */ React3.createElement(
    Comp,
    {
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size, className })),
      ...props
    }
  );
}

// components/ui/textarea.tsx
var React4 = __toESM(require("react"));
function Textarea({ className, ...props }) {
  return /* @__PURE__ */ React4.createElement(
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

// components/ui/comment-composer.tsx
var import_react = require("react");
function CommentComposer({
  value,
  defaultValue = "",
  placeholder = "Add a comment...",
  submitLabel = "Comment",
  cancelLabel = "Cancel",
  disabled = false,
  isPending = false,
  minHeightClassName = "min-h-[96px]",
  containerClassName,
  footerClassName,
  leadingActions,
  helperText,
  onValueChange,
  onSubmit,
  onCancel
}) {
  const [internalValue, setInternalValue] = (0, import_react.useState)(defaultValue);
  const draft = value ?? internalValue;
  (0, import_react.useEffect)(() => {
    if (value === void 0) {
      setInternalValue(defaultValue);
    }
  }, [defaultValue, value]);
  function setDraft(nextValue) {
    if (value === void 0) {
      setInternalValue(nextValue);
    }
    onValueChange?.(nextValue);
  }
  function submit() {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || disabled || isPending) {
      return;
    }
    onSubmit(trimmed);
    if (value === void 0) {
      setInternalValue("");
      onValueChange?.("");
    }
  }
  function handleCancelClick(event) {
    event.stopPropagation();
    if (value === void 0) {
      setInternalValue(defaultValue);
      onValueChange?.(defaultValue);
    }
    onCancel?.();
  }
  function handleSubmitClick(event) {
    event.stopPropagation();
    submit();
  }
  function handleKeyDown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  }
  const hasContent = draft.trim().length > 0;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: containerClassName ?? "flex flex-col gap-2",
      "data-comment-control": "true"
    },
    helperText == null ? null : helperText,
    /* @__PURE__ */ React.createElement(
      Textarea,
      {
        className: `${minHeightClassName} resize-y text-sm`,
        "data-comment-control": "true",
        disabled: disabled || isPending,
        onChange: (event) => setDraft(event.target.value),
        onKeyDown: handleKeyDown,
        placeholder,
        value: draft
      }
    ),
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: footerClassName ?? (leadingActions == null ? "flex justify-end" : "flex items-center justify-between gap-2")
      },
      leadingActions == null ? null : /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1" }, leadingActions),
      /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-end gap-2" }, onCancel ? /* @__PURE__ */ React.createElement(
        Button,
        {
          "data-comment-control": "true",
          disabled: disabled || isPending,
          onClick: handleCancelClick,
          size: "sm",
          type: "button",
          variant: "outline"
        },
        cancelLabel
      ) : null, /* @__PURE__ */ React.createElement(
        Button,
        {
          "data-comment-control": "true",
          disabled: disabled || isPending || !hasContent,
          onClick: handleSubmitClick,
          size: "sm",
          type: "button"
        },
        submitLabel
      ))
    )
  );
}

// components/ui/comment-thread.tsx
var import_lucide_react3 = require("lucide-react");
function CommentThreadCard({
  children,
  className,
  interactive = false,
  onClick,
  onKeyDown,
  selected = false,
  tabIndex,
  testId,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "relative min-w-0 overflow-hidden rounded-lg border border-border",
        interactive && (selected ? "bg-accent transition-colors" : "transition-colors hover:bg-accent/50"),
        className
      ),
      "data-testid": testId,
      onClick,
      onKeyDown,
      tabIndex,
      ...props
    },
    children
  );
}
function CommentThreadMain({
  actions,
  avatar,
  className,
  content
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "flex w-full min-w-0 items-start gap-2 px-3 py-3 sm:gap-3 sm:px-4 sm:py-4",
        className
      )
    },
    avatar,
    /* @__PURE__ */ React.createElement("div", { className: "flex w-0 flex-1 flex-col gap-2" }, content),
    actions
  );
}
function CommentThreadHeader({
  author,
  className,
  metadata
}) {
  return /* @__PURE__ */ React.createElement("div", { className: cn("flex flex-wrap items-center gap-2", className) }, author, metadata);
}
function CommentThreadReplies({
  children,
  className,
  label,
  showDivider = false
}) {
  return /* @__PURE__ */ React.createElement(React.Fragment, null, label ? /* @__PURE__ */ React.createElement("div", { className: "mx-4 flex items-center gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "h-px flex-1 bg-border" }), /* @__PURE__ */ React.createElement("span", { className: "font-medium text-muted-foreground text-xs" }, label), /* @__PURE__ */ React.createElement("div", { className: "h-px flex-1 bg-border" })) : null, /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        showDivider ? "space-y-3 border-border border-t bg-muted/20 px-3 py-3 sm:px-4" : "space-y-3 border-muted border-l-2 bg-muted/20 px-3 py-3 pb-4 pl-8 sm:px-4 sm:pl-12",
        className
      )
    },
    children
  ));
}
function CommentThreadReplyRow({
  actions,
  avatar,
  body,
  header
}) {
  return /* @__PURE__ */ React.createElement("div", { className: "flex items-start gap-2.5" }, avatar, /* @__PURE__ */ React.createElement("div", { className: "flex min-w-0 flex-1 flex-col gap-1" }, header, body), actions);
}

// components/ui/empty.tsx
var import_class_variance_authority2 = require("class-variance-authority");
function Empty({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty",
      className: cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg border-dashed p-6 text-center text-balance md:p-12",
        className
      ),
      ...props
    }
  );
}
function EmptyHeader({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-header",
      className: cn(
        "flex max-w-sm flex-col items-center gap-2 text-center",
        className
      ),
      ...props
    }
  );
}
var emptyMediaVariants = (0, import_class_variance_authority2.cva)(
  "flex shrink-0 items-center justify-center mb-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg:not([class*='size-'])]:size-6"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);
function EmptyMedia({
  className,
  variant = "default",
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-icon",
      "data-variant": variant,
      className: cn(emptyMediaVariants({ variant, className })),
      ...props
    }
  );
}
function EmptyTitle({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-title",
      className: cn("text-lg font-medium tracking-tight", className),
      ...props
    }
  );
}
function EmptyDescription({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-description",
      className: cn(
        "text-muted-foreground [&>a:hover]:text-primary text-sm/relaxed [&>a]:underline [&>a]:underline-offset-4",
        className
      ),
      ...props
    }
  );
}
function EmptyContent({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-content",
      className: cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance",
        className
      ),
      ...props
    }
  );
}

// components/ui/empty-state.tsx
function EmptyState({
  icon: Icon,
  title,
  description,
  className,
  action
}) {
  return /* @__PURE__ */ React.createElement(Empty, { className: cn("py-12", className) }, /* @__PURE__ */ React.createElement(EmptyHeader, null, /* @__PURE__ */ React.createElement(EmptyMedia, { variant: "icon" }, /* @__PURE__ */ React.createElement(Icon, { className: "size-6" })), /* @__PURE__ */ React.createElement(EmptyTitle, null, title), description ? /* @__PURE__ */ React.createElement(EmptyDescription, null, description) : null), action ? /* @__PURE__ */ React.createElement(EmptyContent, null, action) : null);
}

// components/ui/utils.ts
function formatRelativeLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 6e4);
  const absoluteMinutes = Math.abs(diffMinutes);
  if (absoluteMinutes < 1) {
    return "just now";
  }
  if (absoluteMinutes < 60) {
    return `${absoluteMinutes}m ${diffMinutes >= 0 ? "from now" : "ago"}`;
  }
  const absoluteHours = Math.round(absoluteMinutes / 60);
  if (absoluteHours < 24) {
    return `${absoluteHours}h ${diffMinutes >= 0 ? "from now" : "ago"}`;
  }
  const absoluteDays = Math.round(absoluteHours / 24);
  return `${absoluteDays}d ${diffMinutes >= 0 ? "from now" : "ago"}`;
}
function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
var SIMPLE_TUI_TAGS = {
  "local-command-caveat": "caveat",
  "local-command-stdout": "stdout",
  "local-command-stderr": "stderr",
  "system-reminder": "system-reminder",
  "persisted-output": "persisted-output"
};
var COMMAND_TUI_TAGS = [
  "command-name",
  "command-message",
  "command-args"
];
var KNOWN_TUI_TAG_RE = new RegExp(
  `<(?:${[...Object.keys(SIMPLE_TUI_TAGS), ...COMMAND_TUI_TAGS].join("|")})\\b`
);

// components/ui/comments-section.tsx
var import_lucide_react4 = require("lucide-react");
var import_react2 = require("react");
function CommentsSection({
  documentId: _documentId,
  defaultOpen = false,
  comments = [],
  draft,
  disabled = false,
  isSubmitting = false,
  onDraftChange,
  onSubmitComment,
  onReply
}) {
  const [isOpen, setIsOpen] = (0, import_react2.useState)(defaultOpen);
  const [replyingToId, setReplyingToId] = (0, import_react2.useState)(null);
  const hasComments = comments.length > 0;
  return /* @__PURE__ */ React.createElement(CollapsibleSection, { onOpenChange: setIsOpen, open: isOpen, title: "Comments" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, hasComments ? /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, comments.map((comment) => /* @__PURE__ */ React.createElement(
    CommentThreadItemCard,
    {
      comment,
      isReplyOpen: replyingToId === comment.id,
      key: comment.id,
      onCloseReply: () => setReplyingToId(null),
      onOpenReply: () => setReplyingToId(comment.id),
      onReply
    }
  ))) : /* @__PURE__ */ React.createElement(
    EmptyState,
    {
      className: "border-dashed",
      description: "Start a discussion, capture feedback, or ask for clarification on this artifact.",
      icon: import_lucide_react4.MessageSquare,
      title: "No comments yet"
    }
  ), /* @__PURE__ */ React.createElement(
    CommentComposer,
    {
      defaultValue: draft,
      disabled,
      isPending: isSubmitting,
      onSubmit: (body) => {
        onSubmitComment?.(body);
      },
      onValueChange: onDraftChange,
      placeholder: "Add a comment...",
      submitLabel: "Comment"
    }
  )));
}
function CommentThreadItemCard({
  comment,
  isReplyOpen,
  onOpenReply,
  onCloseReply,
  onReply
}) {
  return /* @__PURE__ */ React.createElement(CommentThreadCard, null, /* @__PURE__ */ React.createElement(
    CommentThreadMain,
    {
      avatar: /* @__PURE__ */ React.createElement(
        CommentAvatar,
        {
          author: comment.author.name,
          authorAvatar: comment.author.avatarUrl,
          authorKind: comment.author.kind,
          size: "sm"
        }
      ),
      content: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
        CommentThreadHeader,
        {
          author: /* @__PURE__ */ React.createElement("span", { className: "font-medium text-sm" }, comment.author.name),
          metadata: /* @__PURE__ */ React.createElement(
            "span",
            {
              className: "text-muted-foreground text-xs",
              title: formatDateTime(comment.createdAt)
            },
            formatRelativeLabel(comment.createdAt)
          )
        }
      ), /* @__PURE__ */ React.createElement("p", { className: "whitespace-pre-wrap text-sm" }, comment.body))
    }
  ), comment.replies?.length ? /* @__PURE__ */ React.createElement(CommentThreadReplies, { className: "border-l border-l-border bg-transparent pl-5", showDivider: false }, comment.replies.map((reply) => /* @__PURE__ */ React.createElement(
    CommentThreadReplyRow,
    {
      avatar: /* @__PURE__ */ React.createElement(
        CommentAvatar,
        {
          author: reply.author.name,
          authorAvatar: reply.author.avatarUrl,
          authorKind: reply.author.kind,
          size: "xs"
        }
      ),
      body: /* @__PURE__ */ React.createElement("p", { className: "whitespace-pre-wrap text-sm" }, reply.body),
      header: /* @__PURE__ */ React.createElement(
        CommentThreadHeader,
        {
          author: /* @__PURE__ */ React.createElement("span", { className: "font-medium text-sm" }, reply.author.name),
          metadata: /* @__PURE__ */ React.createElement(
            "span",
            {
              className: "text-muted-foreground text-xs",
              title: formatDateTime(reply.createdAt)
            },
            formatRelativeLabel(reply.createdAt)
          )
        }
      ),
      key: reply.id
    }
  ))) : null, onReply ? /* @__PURE__ */ React.createElement("div", { className: "flex justify-end" }, isReplyOpen ? /* @__PURE__ */ React.createElement("div", { className: "w-full" }, /* @__PURE__ */ React.createElement(
    CommentComposer,
    {
      minHeightClassName: "min-h-[72px]",
      onCancel: onCloseReply,
      onSubmit: (body) => {
        onReply(comment.id, body);
        onCloseReply();
      },
      placeholder: "Reply...",
      submitLabel: "Reply"
    }
  )) : /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "font-medium text-primary text-sm hover:underline",
      onClick: onOpenReply,
      type: "button"
    },
    "Reply"
  )) : null);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CommentsSection
});
//# sourceMappingURL=comments-section.js.map