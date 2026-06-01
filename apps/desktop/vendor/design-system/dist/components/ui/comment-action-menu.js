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

// components/ui/comment-action-menu.tsx
var comment_action_menu_exports = {};
__export(comment_action_menu_exports, {
  CommentActionMenu: () => CommentActionMenu
});
module.exports = __toCommonJS(comment_action_menu_exports);

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

// components/ui/dropdown-menu.tsx
var React3 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_lucide_react = require("lucide-react");
function DropdownMenu({
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(import_radix_ui2.DropdownMenu.Root, { "data-slot": "dropdown-menu", ...props });
}
function DropdownMenuTrigger({
  id: idProp,
  ...props
}) {
  const stableId = React3.useId();
  const id = idProp ?? stableId;
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui2.DropdownMenu.Trigger,
    {
      "data-slot": "dropdown-menu-trigger",
      ...props,
      id
    }
  );
}
function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(import_radix_ui2.DropdownMenu.Portal, null, /* @__PURE__ */ React3.createElement(
    import_radix_ui2.DropdownMenu.Content,
    {
      "data-slot": "dropdown-menu-content",
      sideOffset,
      className: cn(
        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md",
        className
      ),
      ...props
    }
  ));
}
function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui2.DropdownMenu.Item,
    {
      "data-slot": "dropdown-menu-item",
      "data-inset": inset,
      "data-variant": variant,
      className: cn(
        "focus:!bg-muted focus:text-foreground data-[highlighted]:!bg-muted hover:!bg-muted hover:text-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:hover:!bg-destructive/8 data-[variant=destructive]:focus:!bg-destructive/8 data-[variant=destructive]:data-[highlighted]:!bg-destructive/8 dark:data-[variant=destructive]:hover:!bg-destructive/8 dark:data-[variant=destructive]:focus:!bg-destructive/8 dark:data-[variant=destructive]:data-[highlighted]:!bg-destructive/8 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:transition-colors hover:[&_svg:not([class*='text-'])]:text-current focus:[&_svg:not([class*='text-'])]:text-current data-[highlighted]:[&_svg:not([class*='text-'])]:text-current relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      ),
      ...props
    }
  );
}

// components/ui/sonner.tsx
var import_lucide_react2 = require("lucide-react");
var import_next_themes = require("next-themes");
var import_sonner2 = require("sonner");

// components/ui/comment-action-menu.tsx
var import_lucide_react3 = require("lucide-react");
function CommentActionMenu({
  canEdit = true,
  canDelete = true,
  isResolvePending = false,
  onEditToggle,
  onDelete,
  onChatAboutThis,
  onResolveAction,
  resolveLabel,
  copyValue,
  copySuccessMessage = "Copied link",
  chatLabel = "Chat About This"
}) {
  const hasCopyValue = typeof copyValue === "string" && copyValue.length > 0;
  function copyLink() {
    if (!hasCopyValue || !globalThis.navigator.clipboard?.writeText) {
      return;
    }
    globalThis.navigator.clipboard.writeText(copyValue).then(() => import_sonner2.toast.success(copySuccessMessage)).catch(() => {
    });
  }
  return /* @__PURE__ */ React.createElement(DropdownMenu, null, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(
    Button,
    {
      "aria-label": "More actions",
      className: "h-7 w-7 shrink-0 p-0",
      "data-comment-control": "true",
      onClick: (event) => event.stopPropagation(),
      size: "icon",
      variant: "ghost"
    },
    /* @__PURE__ */ React.createElement(import_lucide_react3.Ellipsis, { className: "h-4 w-4" })
  )), /* @__PURE__ */ React.createElement(DropdownMenuContent, { align: "end" }, onResolveAction && resolveLabel ? /* @__PURE__ */ React.createElement(
    DropdownMenuItem,
    {
      disabled: isResolvePending,
      onSelect: onResolveAction
    },
    /* @__PURE__ */ React.createElement(import_lucide_react3.CheckCheck, { className: "mr-2 h-3.5 w-3.5" }),
    resolveLabel
  ) : null, /* @__PURE__ */ React.createElement(DropdownMenuItem, { disabled: !canEdit, onSelect: onEditToggle }, /* @__PURE__ */ React.createElement(import_lucide_react3.Pencil, { className: "mr-2 h-3.5 w-3.5" }), "Edit"), onChatAboutThis ? /* @__PURE__ */ React.createElement(DropdownMenuItem, { onSelect: onChatAboutThis }, /* @__PURE__ */ React.createElement(import_lucide_react3.MessageSquareIcon, { className: "mr-2 h-3.5 w-3.5" }), chatLabel) : null, hasCopyValue ? /* @__PURE__ */ React.createElement(DropdownMenuItem, { onSelect: copyLink }, /* @__PURE__ */ React.createElement(import_lucide_react3.Copy, { className: "mr-2 h-3.5 w-3.5" }), "Copy Link") : null, /* @__PURE__ */ React.createElement(DropdownMenuItem, { disabled: !canDelete, onSelect: onDelete }, /* @__PURE__ */ React.createElement(import_lucide_react3.Trash2, { className: "mr-2 h-3.5 w-3.5" }), "Delete")));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CommentActionMenu
});
//# sourceMappingURL=comment-action-menu.js.map