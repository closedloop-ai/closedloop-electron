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

// components/ui/attachment-list.tsx
var attachment_list_exports = {};
__export(attachment_list_exports, {
  AttachmentList: () => AttachmentList
});
module.exports = __toCommonJS(attachment_list_exports);

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

// components/ui/attachment-list.tsx
var import_lucide_react = require("lucide-react");
function AttachmentList({
  attachments,
  className,
  onDownload,
  onDelete,
  actionVisibility = "hover",
  emptyState = null
}) {
  if (attachments.length === 0) {
    return emptyState;
  }
  return /* @__PURE__ */ React.createElement("div", { className: cn("flex flex-wrap items-center gap-2", className) }, attachments.map((attachment) => /* @__PURE__ */ React.createElement(
    AttachmentChip,
    {
      actionVisibility,
      attachment,
      key: attachment.id,
      onDelete,
      onDownload
    }
  )));
}
function AttachmentChip({
  attachment,
  onDownload,
  onDelete,
  actionVisibility
}) {
  const actionClassName = actionVisibility === "always" ? void 0 : "opacity-0 group-hover:opacity-100";
  return /* @__PURE__ */ React.createElement("div", { className: "group flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-sm" }, attachment.previewUrl ? /* @__PURE__ */ React.createElement(
    "a",
    {
      className: "flex shrink-0 hover:opacity-90",
      href: attachment.previewUrl,
      rel: "noopener noreferrer",
      target: "_blank"
    },
    /* @__PURE__ */ React.createElement(
      "img",
      {
        alt: attachment.filename,
        className: "h-6 w-6 shrink-0 rounded object-cover",
        height: 24,
        src: attachment.previewUrl,
        width: 24
      }
    )
  ) : /* @__PURE__ */ React.createElement(import_lucide_react.FileIcon, { className: "h-4 w-4 shrink-0 text-muted-foreground" }), /* @__PURE__ */ React.createElement("span", { className: "max-w-[180px] truncate font-medium" }, attachment.filename), /* @__PURE__ */ React.createElement("span", { className: "shrink-0 text-muted-foreground text-xs" }, formatAttachmentSize(attachment.sizeBytes)), !attachment.previewUrl && onDownload ? /* @__PURE__ */ React.createElement(
    Button,
    {
      "aria-label": `Download ${attachment.filename}`,
      className: cn("h-6 w-6", actionClassName),
      onClick: () => onDownload(attachment),
      size: "icon",
      variant: "ghost"
    },
    /* @__PURE__ */ React.createElement(import_lucide_react.DownloadIcon, { className: "h-3.5 w-3.5" })
  ) : null, onDelete ? /* @__PURE__ */ React.createElement(
    Button,
    {
      "aria-label": `Delete ${attachment.filename}`,
      className: cn("h-6 w-6", actionClassName),
      onClick: () => onDelete(attachment),
      size: "icon",
      variant: "ghost"
    },
    /* @__PURE__ */ React.createElement(import_lucide_react.Trash2Icon, { className: "h-3.5 w-3.5" })
  ) : null);
}
function formatAttachmentSize(sizeBytes) {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.ceil(sizeBytes / 1024)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AttachmentList
});
//# sourceMappingURL=attachment-list.js.map