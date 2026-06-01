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

// components/ui/status-metadata-section.tsx
var status_metadata_section_exports = {};
__export(status_metadata_section_exports, {
  StatusMetadataSection: () => StatusMetadataSection
});
module.exports = __toCommonJS(status_metadata_section_exports);

// components/ui/label.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/label.tsx
function Label({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.Label.Root,
    {
      "data-slot": "label",
      className: cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      ),
      ...props
    }
  );
}

// components/ui/tabs.tsx
var React3 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");

// components/ui/metadata-panel.tsx
function MetadataSection({
  children,
  separator,
  className,
  layout = "vertical"
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        layout === "horizontal" ? "flex flex-wrap items-center gap-2" : "space-y-2",
        layout === "vertical" && separator ? "border-t pt-4" : null,
        className
      )
    },
    children
  );
}

// components/ui/select.tsx
var React4 = __toESM(require("react"));
var import_radix_ui3 = require("radix-ui");
var import_lucide_react = require("lucide-react");
function Select({
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(import_radix_ui3.Select.Root, { "data-slot": "select", ...props });
}
function SelectValue({
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(import_radix_ui3.Select.Value, { "data-slot": "select-value", ...props });
}
function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(
    import_radix_ui3.Select.Trigger,
    {
      "data-slot": "select-trigger",
      "data-size": size,
      className: cn(
        "border-input-border data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-input hover:bg-muted dark:bg-input dark:hover:bg-muted flex w-fit items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm whitespace-nowrap transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      ),
      ...props
    },
    children,
    /* @__PURE__ */ React4.createElement(import_radix_ui3.Select.Icon, { asChild: true }, /* @__PURE__ */ React4.createElement(import_lucide_react.ChevronDownIcon, { className: "size-4 opacity-50" }))
  );
}
function SelectContent({
  className,
  children,
  position = "popper",
  align = "center",
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(import_radix_ui3.Select.Portal, null, /* @__PURE__ */ React4.createElement(
    import_radix_ui3.Select.Content,
    {
      "data-slot": "select-content",
      className: cn(
        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
        position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      ),
      position,
      align,
      ...props
    },
    /* @__PURE__ */ React4.createElement(SelectScrollUpButton, null),
    /* @__PURE__ */ React4.createElement(
      import_radix_ui3.Select.Viewport,
      {
        className: cn(
          "p-1",
          position === "popper" && "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
        )
      },
      children
    ),
    /* @__PURE__ */ React4.createElement(SelectScrollDownButton, null)
  ));
}
function SelectItem({
  className,
  children,
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(
    import_radix_ui3.Select.Item,
    {
      "data-slot": "select-item",
      className: cn(
        "focus:bg-muted focus:text-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React4.createElement("span", { className: "absolute right-2 flex size-3.5 items-center justify-center" }, /* @__PURE__ */ React4.createElement(import_radix_ui3.Select.ItemIndicator, null, /* @__PURE__ */ React4.createElement(import_lucide_react.CheckIcon, { className: "size-4" }))),
    /* @__PURE__ */ React4.createElement(import_radix_ui3.Select.ItemText, null, children)
  );
}
function SelectScrollUpButton({
  className,
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(
    import_radix_ui3.Select.ScrollUpButton,
    {
      "data-slot": "select-scroll-up-button",
      className: cn(
        "flex cursor-default items-center justify-center py-1",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React4.createElement(import_lucide_react.ChevronUpIcon, { className: "size-4" })
  );
}
function SelectScrollDownButton({
  className,
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(
    import_radix_ui3.Select.ScrollDownButton,
    {
      "data-slot": "select-scroll-down-button",
      className: cn(
        "flex cursor-default items-center justify-center py-1",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React4.createElement(import_lucide_react.ChevronDownIcon, { className: "size-4" })
  );
}

// components/ui/status-icon.tsx
var React6 = __toESM(require("react"));

// components/ui/internal/status-icon-shared.tsx
var React5 = __toESM(require("react"));
var CENTER = 10;
var RADIUS = 9;
var STROKE_WIDTH = 2;
var CIRCUMFERENCE = 2 * Math.PI * RADIUS;
var INNER_PATH_RADIUS = 3;
var INNER_STROKE_WIDTH = INNER_PATH_RADIUS * 2;
var INNER_CIRCUMFERENCE = 2 * Math.PI * INNER_PATH_RADIUS;
var ICON_STROKE_WIDTH = 1.66;
function FilledCheckCircle({ fill }) {
  return /* @__PURE__ */ React5.createElement(React5.Fragment, null, /* @__PURE__ */ React5.createElement("circle", { cx: CENTER, cy: CENTER, r: RADIUS + STROKE_WIDTH / 2, fill }), /* @__PURE__ */ React5.createElement(
    "path",
    {
      d: "M6.5 10.5L9.5 13.5L14 7.5",
      stroke: "var(--background)",
      strokeWidth: ICON_STROKE_WIDTH,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      fill: "none"
    }
  ));
}
function FilledXCircle({ fill }) {
  return /* @__PURE__ */ React5.createElement(React5.Fragment, null, /* @__PURE__ */ React5.createElement("circle", { cx: CENTER, cy: CENTER, r: RADIUS + STROKE_WIDTH / 2, fill }), /* @__PURE__ */ React5.createElement(
    "path",
    {
      d: "M7 7L13 13M13 7L7 13",
      stroke: "var(--background)",
      strokeWidth: ICON_STROKE_WIDTH,
      strokeLinecap: "round",
      fill: "none"
    }
  ));
}

// components/ui/status-icon.tsx
var STATUS_LABELS = {
  backlog: "Backlog",
  todo: "To do",
  started: "In Progress",
  "in-progress": "In progress",
  "in-review": "In review",
  executed: "Executed",
  complete: "Complete",
  "wont-do": "Won't do",
  decorative: "Status"
};
function getStatusConfig(status) {
  switch (status) {
    case "backlog": {
      return { percentage: 0, color: "var(--progress)", dashed: true, filled: false, icon: null };
    }
    case "todo": {
      return { percentage: 0, color: "var(--progress)", dashed: false, filled: false, icon: null };
    }
    case "started": {
      return { percentage: 25, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "in-progress": {
      return { percentage: 48.5, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "in-review": {
      return { percentage: 73.5, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "executed": {
      return { percentage: 100, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "complete": {
      return { percentage: 100, color: "var(--success)", dashed: false, filled: true, icon: "check" };
    }
    case "wont-do": {
      return { percentage: 100, color: "var(--foreground)", dashed: false, filled: true, icon: "x" };
    }
    default: {
      return { percentage: 48.5, color: "var(--muted-foreground)", dashed: false, filled: false, icon: null, trackColor: "var(--muted-foreground)", strokeWidth: 1.5 };
    }
  }
}
function StatusIcon({
  status,
  size = 16,
  thinking = false,
  className,
  ...props
}) {
  const config = getStatusConfig(status);
  const defaultLabel = STATUS_LABELS[status];
  if (config.filled) {
    return /* @__PURE__ */ React6.createElement(
      "svg",
      {
        role: "img",
        "aria-label": defaultLabel,
        "data-slot": "status-icon",
        width: size,
        height: size,
        viewBox: "0 0 20 20",
        fill: "none",
        className: cn("shrink-0", className),
        ...props
      },
      config.icon === "check" && /* @__PURE__ */ React6.createElement(FilledCheckCircle, { fill: config.color }),
      config.icon === "x" && /* @__PURE__ */ React6.createElement(FilledXCircle, { fill: config.color })
    );
  }
  const sw = config.strokeWidth ?? STROKE_WIDTH;
  const outerOffset = CIRCUMFERENCE * (1 - config.percentage / 100);
  const innerOffset = INNER_CIRCUMFERENCE * (1 - config.percentage / 100);
  const spinnerDash = CIRCUMFERENCE * 0.25;
  const spinnerGap = CIRCUMFERENCE - spinnerDash;
  const hasArc = config.percentage > 0;
  return /* @__PURE__ */ React6.createElement(
    "svg",
    {
      role: "img",
      "aria-label": defaultLabel,
      "data-slot": "status-icon",
      width: size,
      height: size,
      viewBox: "0 0 20 20",
      fill: "none",
      className: cn("shrink-0", className),
      ...props
    },
    /* @__PURE__ */ React6.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: config.trackColor ?? "var(--progress)",
        strokeWidth: sw,
        fill: "none",
        strokeDasharray: config.dashed ? "3 3" : void 0
      }
    ),
    !thinking && hasArc && /* @__PURE__ */ React6.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: config.color,
        strokeWidth: sw,
        strokeLinecap: "round",
        fill: "none",
        strokeDasharray: CIRCUMFERENCE,
        strokeDashoffset: outerOffset,
        transform: `rotate(-90 ${CENTER} ${CENTER})`,
        className: "transition-all duration-300 ease-in-out"
      }
    ),
    thinking && /* @__PURE__ */ React6.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: "var(--thinking)",
        strokeWidth: sw,
        strokeLinecap: "round",
        fill: "none",
        strokeDasharray: `${spinnerDash} ${spinnerGap}`,
        className: "animate-spin origin-center"
      }
    ),
    hasArc && /* @__PURE__ */ React6.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: INNER_PATH_RADIUS,
        stroke: config.color,
        strokeWidth: INNER_STROKE_WIDTH,
        fill: "none",
        strokeDasharray: INNER_CIRCUMFERENCE,
        strokeDashoffset: innerOffset,
        transform: `rotate(-90 ${CENTER} ${CENTER})`,
        className: "transition-all duration-300 ease-in-out"
      }
    )
  );
}

// components/ui/user-select-popover.tsx
var React12 = __toESM(require("react"));
var import_lucide_react4 = require("lucide-react");

// components/ui/button.tsx
var React7 = __toESM(require("react"));
var import_radix_ui4 = require("radix-ui");
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
  const Comp = asChild ? import_radix_ui4.Slot.Slot : "button";
  return /* @__PURE__ */ React7.createElement(
    Comp,
    {
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size, className })),
      ...props
    }
  );
}

// components/ui/popover.tsx
var React8 = __toESM(require("react"));
var import_radix_ui5 = require("radix-ui");
function Popover({
  ...props
}) {
  return /* @__PURE__ */ React8.createElement(import_radix_ui5.Popover.Root, { "data-slot": "popover", ...props });
}
function PopoverTrigger({
  ...props
}) {
  return /* @__PURE__ */ React8.createElement(import_radix_ui5.Popover.Trigger, { "data-slot": "popover-trigger", ...props });
}
function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}) {
  return /* @__PURE__ */ React8.createElement(import_radix_ui5.Popover.Portal, null, /* @__PURE__ */ React8.createElement(
    import_radix_ui5.Popover.Content,
    {
      "data-slot": "popover-content",
      align,
      sideOffset,
      className: cn(
        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden",
        className
      ),
      ...props
    }
  ));
}

// components/ui/command.tsx
var React10 = __toESM(require("react"));
var import_cmdk = require("cmdk");
var import_lucide_react3 = require("lucide-react");

// components/ui/dialog.tsx
var React9 = __toESM(require("react"));
var import_radix_ui6 = require("radix-ui");
var import_lucide_react2 = require("lucide-react");

// components/ui/command.tsx
function Command({
  className,
  ...props
}) {
  return /* @__PURE__ */ React10.createElement(
    import_cmdk.Command,
    {
      "data-slot": "command",
      className: cn(
        "bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md",
        className
      ),
      ...props
    }
  );
}
function CommandInput({
  className,
  ...props
}) {
  return /* @__PURE__ */ React10.createElement(
    "div",
    {
      "data-slot": "command-input-wrapper",
      className: "flex h-9 items-center gap-2 border-b px-3"
    },
    /* @__PURE__ */ React10.createElement(import_lucide_react3.SearchIcon, { className: "size-4 shrink-0 opacity-50" }),
    /* @__PURE__ */ React10.createElement(
      import_cmdk.Command.Input,
      {
        "data-slot": "command-input",
        className: cn(
          "placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
          className
        ),
        ...props
      }
    )
  );
}
function CommandList({
  className,
  ...props
}) {
  return /* @__PURE__ */ React10.createElement(
    import_cmdk.Command.List,
    {
      "data-slot": "command-list",
      className: cn(
        "max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto",
        className
      ),
      ...props
    }
  );
}
function CommandEmpty({
  ...props
}) {
  return /* @__PURE__ */ React10.createElement(
    import_cmdk.Command.Empty,
    {
      "data-slot": "command-empty",
      className: "py-6 text-center text-sm",
      ...props
    }
  );
}
function CommandGroup({
  className,
  ...props
}) {
  return /* @__PURE__ */ React10.createElement(
    import_cmdk.Command.Group,
    {
      "data-slot": "command-group",
      className: cn(
        "text-foreground [&_[cmdk-group-heading]]:text-muted-foreground overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium",
        className
      ),
      ...props
    }
  );
}
function CommandItem({
  className,
  ...props
}) {
  return /* @__PURE__ */ React10.createElement(
    import_cmdk.Command.Item,
    {
      "data-slot": "command-item",
      className: cn(
        "data-[selected=true]:bg-muted data-[selected=true]:text-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      ),
      ...props
    }
  );
}

// components/ui/avatar.tsx
var React11 = __toESM(require("react"));
var import_radix_ui7 = require("radix-ui");
function Avatar({
  className,
  ...props
}) {
  return /* @__PURE__ */ React11.createElement(
    import_radix_ui7.Avatar.Root,
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
  return /* @__PURE__ */ React11.createElement(
    import_radix_ui7.Avatar.Image,
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
  return /* @__PURE__ */ React11.createElement(
    import_radix_ui7.Avatar.Fallback,
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

// components/ui/user-select-popover.tsx
function getInitials(name) {
  return name.split(" ").filter((part) => part.length > 0).map((part) => part[0]).join("").toUpperCase().slice(0, 2);
}
function UserSelectPopover({
  value,
  onSelect,
  users,
  placeholder = "Select user...",
  iconOnly = false,
  trigger,
  disabled = false,
  className
}) {
  const [open, setOpen] = React12.useState(false);
  const handleSelect = (user) => {
    onSelect(user);
    setOpen(false);
  };
  const handleClear = () => {
    onSelect(null);
    setOpen(false);
  };
  const defaultTrigger = iconOnly ? /* @__PURE__ */ React12.createElement(
    Button,
    {
      variant: "ghost",
      size: "icon",
      className: cn("h-8 w-8 text-muted-foreground hover:text-foreground", className),
      disabled
    },
    /* @__PURE__ */ React12.createElement(import_lucide_react4.UserPlusIcon, { className: "h-4 w-4" }),
    /* @__PURE__ */ React12.createElement("span", { className: "sr-only" }, placeholder)
  ) : /* @__PURE__ */ React12.createElement(
    Button,
    {
      variant: "outline",
      role: "combobox",
      "aria-expanded": open,
      className: cn("w-[200px] justify-start", className),
      disabled
    },
    value ? /* @__PURE__ */ React12.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React12.createElement(Avatar, { className: "h-5 w-5" }, value.avatarUrl && /* @__PURE__ */ React12.createElement(AvatarImage, { src: value.avatarUrl, alt: value.name }), /* @__PURE__ */ React12.createElement(AvatarFallback, { className: "text-[10px]" }, value.initials || getInitials(value.name))), /* @__PURE__ */ React12.createElement("span", { className: "truncate" }, value.name)) : /* @__PURE__ */ React12.createElement("span", { className: "text-muted-foreground" }, placeholder)
  );
  return /* @__PURE__ */ React12.createElement(Popover, { open, onOpenChange: setOpen }, /* @__PURE__ */ React12.createElement(PopoverTrigger, { asChild: true }, trigger || defaultTrigger), /* @__PURE__ */ React12.createElement(PopoverContent, { className: "w-[250px] p-0", align: "start" }, /* @__PURE__ */ React12.createElement(Command, null, /* @__PURE__ */ React12.createElement(CommandInput, { placeholder: "Search users..." }), /* @__PURE__ */ React12.createElement(CommandList, null, /* @__PURE__ */ React12.createElement(CommandEmpty, null, "No users found."), /* @__PURE__ */ React12.createElement(CommandGroup, null, value && /* @__PURE__ */ React12.createElement(
    CommandItem,
    {
      onSelect: handleClear,
      className: "cursor-pointer text-muted-foreground hover:bg-muted hover:text-foreground"
    },
    "Clear selection"
  ), users.map((user) => /* @__PURE__ */ React12.createElement(
    CommandItem,
    {
      key: user.id,
      value: `${user.name} ${user.email || ""}`,
      onSelect: () => handleSelect(user),
      className: "cursor-pointer hover:bg-muted"
    },
    /* @__PURE__ */ React12.createElement(Avatar, { className: "mr-2 h-6 w-6" }, user.avatarUrl && /* @__PURE__ */ React12.createElement(AvatarImage, { src: user.avatarUrl, alt: user.name }), /* @__PURE__ */ React12.createElement(AvatarFallback, { className: "text-[10px]" }, user.initials || getInitials(user.name))),
    /* @__PURE__ */ React12.createElement("div", { className: "flex flex-col" }, /* @__PURE__ */ React12.createElement("span", null, user.name), user.email && /* @__PURE__ */ React12.createElement("span", { className: "text-xs text-muted-foreground" }, user.email))
  )))))));
}

// components/ui/status-metadata-section.tsx
var import_react = require("react");
function StatusMetadataSection({
  status,
  assignee,
  teamMembers,
  onStatusChange,
  onAssigneeChange,
  options,
  className,
  layout = "vertical"
}) {
  const statusId = (0, import_react.useId)();
  const statusOptions = options.map((statusOption) => /* @__PURE__ */ React.createElement(SelectItem, { key: statusOption.value, value: statusOption.value }, /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1.5" }, /* @__PURE__ */ React.createElement(StatusIcon, { size: 16, status: statusOption.iconStatus }), statusOption.label)));
  const content = layout === "horizontal" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Select, { onValueChange: onStatusChange, value: status }, /* @__PURE__ */ React.createElement(
    SelectTrigger,
    {
      className: "min-w-0 justify-start gap-1 [&>:last-child]:hidden",
      size: "sm"
    },
    /* @__PURE__ */ React.createElement(SelectValue, null)
  ), /* @__PURE__ */ React.createElement(SelectContent, null, statusOptions)), /* @__PURE__ */ React.createElement(
    UserSelectPopover,
    {
      className: "h-8 w-auto min-w-[7rem] px-3",
      disabled: teamMembers.length === 0,
      onSelect: onAssigneeChange,
      placeholder: "Select assignee...",
      users: teamMembers,
      value: assignee
    }
  )) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement(Label, { htmlFor: statusId }, "Status"), /* @__PURE__ */ React.createElement(Select, { onValueChange: onStatusChange, value: status }, /* @__PURE__ */ React.createElement(
    SelectTrigger,
    {
      className: "min-w-0 justify-start bg-transparent hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent [&>:last-child]:hidden",
      id: statusId
    },
    /* @__PURE__ */ React.createElement(SelectValue, null)
  ), /* @__PURE__ */ React.createElement(SelectContent, null, statusOptions))), /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement(Label, null, "Assignee"), /* @__PURE__ */ React.createElement(
    UserSelectPopover,
    {
      className: "bg-transparent hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent",
      disabled: teamMembers.length === 0,
      onSelect: onAssigneeChange,
      placeholder: "Select assignee...",
      users: teamMembers,
      value: assignee
    }
  )));
  return /* @__PURE__ */ React.createElement(MetadataSection, { className, layout }, content);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StatusMetadataSection
});
//# sourceMappingURL=status-metadata-section.js.map