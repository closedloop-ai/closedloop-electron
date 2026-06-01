var React = require("react");
"use strict";
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

// components/ui/primitives/pack-card.tsx
var pack_card_exports = {};
__export(pack_card_exports, {
  PackCard: () => PackCard
});
module.exports = __toCommonJS(pack_card_exports);

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

// components/ui/button.tsx
var React3 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_class_variance_authority2 = require("class-variance-authority");
var buttonVariants = (0, import_class_variance_authority2.cva)(
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

// components/ui/card.tsx
var React4 = __toESM(require("react"));
function Card({ className, ...props }) {
  return /* @__PURE__ */ React4.createElement(
    "div",
    {
      "data-slot": "card",
      className: cn(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
        className
      ),
      ...props
    }
  );
}
function CardHeader({ className, ...props }) {
  return /* @__PURE__ */ React4.createElement(
    "div",
    {
      "data-slot": "card-header",
      className: cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      ),
      ...props
    }
  );
}
function CardTitle({ className, ...props }) {
  return /* @__PURE__ */ React4.createElement(
    "div",
    {
      "data-slot": "card-title",
      className: cn("leading-none font-semibold", className),
      ...props
    }
  );
}
function CardDescription({ className, ...props }) {
  return /* @__PURE__ */ React4.createElement(
    "div",
    {
      "data-slot": "card-description",
      className: cn("text-muted-foreground text-sm", className),
      ...props
    }
  );
}
function CardContent({ className, ...props }) {
  return /* @__PURE__ */ React4.createElement(
    "div",
    {
      "data-slot": "card-content",
      className: cn("px-6", className),
      ...props
    }
  );
}

// components/ui/primitives/sparkline.tsx
var import_react = require("react");
function Sparkline({
  values,
  width = 80,
  height = 20,
  className,
  stroke = "currentColor"
}) {
  const points = (0, import_react.useMemo)(() => {
    const clean = values.map(
      (value) => typeof value === "number" && Number.isFinite(value) ? value : null
    ).filter((value) => value !== null);
    if (clean.length < 2) {
      return null;
    }
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const range = max - min || 1;
    const step = width / (clean.length - 1);
    return clean.map((value, index) => {
      const x = index * step;
      const y = height - (value - min) / range * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }, [height, values, width]);
  if (!points) {
    return null;
  }
  return /* @__PURE__ */ React.createElement(
    "svg",
    {
      "aria-hidden": "true",
      className,
      height,
      viewBox: `0 0 ${width} ${height}`,
      width
    },
    /* @__PURE__ */ React.createElement(
      "polyline",
      {
        fill: "none",
        points,
        stroke,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: "1.5"
      }
    )
  );
}

// components/ui/utils.ts
var badgeClassName = "rounded-md px-1.5 py-0.5 font-medium text-[10px]";
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

// components/ui/primitives/pack-card.tsx
function PackCard({
  pack,
  selected = false,
  onSelect,
  onInstallPack
}) {
  return /* @__PURE__ */ React.createElement(Card, { className: selected ? "ring-1 ring-primary/40" : void 0 }, /* @__PURE__ */ React.createElement(CardHeader, { className: "space-y-2" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-start justify-between gap-3" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "space-y-1 text-left",
      disabled: !onSelect,
      onClick: () => onSelect?.(pack.id),
      type: "button"
    },
    /* @__PURE__ */ React.createElement(CardTitle, null, pack.displayName),
    /* @__PURE__ */ React.createElement(CardDescription, { className: "font-mono" }, pack.id)
  ), /* @__PURE__ */ React.createElement("div", { className: "text-right text-amber-600" }, /* @__PURE__ */ React.createElement("div", { className: "font-semibold text-lg" }, "\u2605 ", pack.stars || "\u2014"), /* @__PURE__ */ React.createElement(
    Sparkline,
    {
      className: "mt-1 ml-auto",
      values: (pack.history || []).map((point) => point.stars)
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-1.5" }, pack.category ? /* @__PURE__ */ React.createElement(Badge, { className: badgeClassName, variant: "muted" }, pack.category) : null, pack.installedHarnesses.length > 0 ? /* @__PURE__ */ React.createElement(Badge, { className: badgeClassName, variant: "success" }, "Installed (", pack.installedHarnesses.join(", "), ")") : /* @__PURE__ */ React.createElement(Badge, { className: badgeClassName, variant: "muted" }, "Not installed"), pack.usageCount ? /* @__PURE__ */ React.createElement(Badge, { className: badgeClassName, variant: "muted" }, pack.usageCount, " uses") : null)), /* @__PURE__ */ React.createElement(CardContent, { className: "space-y-3" }, pack.description ? /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, pack.description) : null, pack.placeholderReason ? /* @__PURE__ */ React.createElement("p", { className: "text-amber-700 text-xs italic" }, pack.placeholderReason) : null, pack.installNotes ? /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-xs" }, pack.installNotes) : null, pack.usage ? /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-xs" }, "Used ", pack.usage.toolCalls, " times across ", pack.usage.sessions, " ", "sessions.") : null, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-2" }, /* @__PURE__ */ React.createElement(
    Button,
    {
      disabled: !onSelect,
      onClick: () => onSelect?.(pack.id),
      size: "sm",
      variant: "secondary"
    },
    "View details"
  ), pack.harnesses.map((harness) => /* @__PURE__ */ React.createElement(
    Button,
    {
      disabled: !onInstallPack,
      key: harness,
      onClick: () => onInstallPack?.(pack.id, harness),
      size: "sm",
      variant: "outline"
    },
    pack.installedHarnesses.includes(harness) ? "Uninstall" : "Install",
    " ",
    harness
  )))));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PackCard
});
//# sourceMappingURL=pack-card.js.map