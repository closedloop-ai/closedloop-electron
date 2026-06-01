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

// components/ui/compute-target-card.tsx
var compute_target_card_exports = {};
__export(compute_target_card_exports, {
  ComputeTargetCard: () => ComputeTargetCard
});
module.exports = __toCommonJS(compute_target_card_exports);

// components/ui/badge.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/badge.tsx
var badgeVariants = (0, import_class_variance_authority.cva)(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive: "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        success: "border-success/25 bg-success/12 text-success [a&]:hover:bg-success/18",
        warning: "border-warning/30 bg-warning/14 text-warning-foreground [a&]:hover:bg-warning/20",
        info: "border-info/25 bg-info/12 text-info [a&]:hover:bg-info/18",
        accent: "border-primary/20 bg-primary/10 text-primary [a&]:hover:bg-primary/16",
        muted: "border-border bg-muted/70 text-muted-foreground [a&]:hover:bg-muted",
        outline: "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);
function Badge({
  className,
  variant,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? import_radix_ui.Slot.Slot : "span";
  return /* @__PURE__ */ React2.createElement(
    Comp,
    {
      "data-slot": "badge",
      className: cn(badgeVariants({ variant }), className),
      ...props
    }
  );
}

// components/ui/switch.tsx
var React3 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
function Switch({
  className,
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui2.Switch.Root,
    {
      "data-slot": "switch",
      className: cn(
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/30 focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-muted-foreground/40 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React3.createElement(
      import_radix_ui2.Switch.Thumb,
      {
        "data-slot": "switch-thumb",
        className: cn(
          "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
        )
      }
    )
  );
}

// components/ui/compute-target-card.tsx
function ComputeTargetCard({
  name,
  isOnline,
  securityBadge,
  subtitle,
  actions,
  shareChecked,
  shareDisabled = false,
  onShareCheckedChange,
  shareTitle = "Share with team",
  shareDescription = "Allow anyone in your org to run jobs on this machine",
  systemCheck,
  className
}) {
  return /* @__PURE__ */ React.createElement("div", { className: cn("rounded-lg border p-3", className) }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "min-w-0 flex-1" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("p", { className: "truncate font-medium" }, name), /* @__PURE__ */ React.createElement(Badge, { className: "capitalize", variant: isOnline ? "default" : "secondary" }, isOnline ? "online" : "offline"), securityBadge), /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-xs" }, subtitle)), actions ? /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, actions) : null), /* @__PURE__ */ React.createElement("div", { className: "mt-2 flex items-center justify-between border-t pt-2" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "text-sm" }, shareTitle), /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-xs" }, shareDescription)), /* @__PURE__ */ React.createElement(
    Switch,
    {
      checked: shareChecked,
      disabled: shareDisabled,
      onCheckedChange: onShareCheckedChange
    }
  )), systemCheck);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ComputeTargetCard
});
//# sourceMappingURL=compute-target-card.js.map