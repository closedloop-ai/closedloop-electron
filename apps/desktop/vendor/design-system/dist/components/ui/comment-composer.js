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

// components/ui/comment-composer.tsx
var comment_composer_exports = {};
__export(comment_composer_exports, {
  CommentComposer: () => CommentComposer
});
module.exports = __toCommonJS(comment_composer_exports);

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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CommentComposer
});
//# sourceMappingURL=comment-composer.js.map