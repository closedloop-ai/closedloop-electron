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

// components/ui/composites/pack-install-dialog.tsx
var pack_install_dialog_exports = {};
__export(pack_install_dialog_exports, {
  PackInstallDialog: () => PackInstallDialog
});
module.exports = __toCommonJS(pack_install_dialog_exports);

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

// components/ui/dialog.tsx
var React3 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_lucide_react = require("lucide-react");
function Dialog({
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(import_radix_ui2.Dialog.Root, { "data-slot": "dialog", ...props });
}
function DialogPortal({
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(import_radix_ui2.Dialog.Portal, { "data-slot": "dialog-portal", ...props });
}
function DialogOverlay({
  className,
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui2.Dialog.Overlay,
    {
      "data-slot": "dialog-overlay",
      className: cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      ),
      ...props
    }
  );
}
function DialogContent({
  className,
  children,
  showCloseButton = true,
  showOverlay = true,
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(DialogPortal, { "data-slot": "dialog-portal" }, showOverlay && /* @__PURE__ */ React3.createElement(DialogOverlay, null), /* @__PURE__ */ React3.createElement(
    import_radix_ui2.Dialog.Content,
    {
      "data-slot": "dialog-content",
      className: cn(
        "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
        className
      ),
      ...props
    },
    children,
    showCloseButton && /* @__PURE__ */ React3.createElement(
      import_radix_ui2.Dialog.Close,
      {
        "data-slot": "dialog-close",
        className: "ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
      },
      /* @__PURE__ */ React3.createElement(import_lucide_react.XIcon, null),
      /* @__PURE__ */ React3.createElement("span", { className: "sr-only" }, "Close")
    )
  ));
}
function DialogHeader({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "div",
    {
      "data-slot": "dialog-header",
      className: cn("flex flex-col gap-2 text-center sm:text-left", className),
      ...props
    }
  );
}
function DialogFooter({ className, ...props }) {
  return /* @__PURE__ */ React3.createElement(
    "div",
    {
      "data-slot": "dialog-footer",
      className: cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      ),
      ...props
    }
  );
}
function DialogTitle({
  className,
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui2.Dialog.Title,
    {
      "data-slot": "dialog-title",
      className: cn("text-lg leading-none font-semibold", className),
      ...props
    }
  );
}
function DialogDescription({
  className,
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui2.Dialog.Description,
    {
      "data-slot": "dialog-description",
      className: cn("text-muted-foreground text-sm", className),
      ...props
    }
  );
}

// components/ui/label.tsx
var React4 = __toESM(require("react"));
var import_radix_ui3 = require("radix-ui");
function Label({
  className,
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(
    import_radix_ui3.Label.Root,
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

// components/ui/select.tsx
var React5 = __toESM(require("react"));
var import_radix_ui4 = require("radix-ui");
var import_lucide_react2 = require("lucide-react");
function Select({
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(import_radix_ui4.Select.Root, { "data-slot": "select", ...props });
}
function SelectValue({
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(import_radix_ui4.Select.Value, { "data-slot": "select-value", ...props });
}
function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(
    import_radix_ui4.Select.Trigger,
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
    /* @__PURE__ */ React5.createElement(import_radix_ui4.Select.Icon, { asChild: true }, /* @__PURE__ */ React5.createElement(import_lucide_react2.ChevronDownIcon, { className: "size-4 opacity-50" }))
  );
}
function SelectContent({
  className,
  children,
  position = "popper",
  align = "center",
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(import_radix_ui4.Select.Portal, null, /* @__PURE__ */ React5.createElement(
    import_radix_ui4.Select.Content,
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
    /* @__PURE__ */ React5.createElement(SelectScrollUpButton, null),
    /* @__PURE__ */ React5.createElement(
      import_radix_ui4.Select.Viewport,
      {
        className: cn(
          "p-1",
          position === "popper" && "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
        )
      },
      children
    ),
    /* @__PURE__ */ React5.createElement(SelectScrollDownButton, null)
  ));
}
function SelectItem({
  className,
  children,
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(
    import_radix_ui4.Select.Item,
    {
      "data-slot": "select-item",
      className: cn(
        "focus:bg-muted focus:text-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React5.createElement("span", { className: "absolute right-2 flex size-3.5 items-center justify-center" }, /* @__PURE__ */ React5.createElement(import_radix_ui4.Select.ItemIndicator, null, /* @__PURE__ */ React5.createElement(import_lucide_react2.CheckIcon, { className: "size-4" }))),
    /* @__PURE__ */ React5.createElement(import_radix_ui4.Select.ItemText, null, children)
  );
}
function SelectScrollUpButton({
  className,
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(
    import_radix_ui4.Select.ScrollUpButton,
    {
      "data-slot": "select-scroll-up-button",
      className: cn(
        "flex cursor-default items-center justify-center py-1",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React5.createElement(import_lucide_react2.ChevronUpIcon, { className: "size-4" })
  );
}
function SelectScrollDownButton({
  className,
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(
    import_radix_ui4.Select.ScrollDownButton,
    {
      "data-slot": "select-scroll-down-button",
      className: cn(
        "flex cursor-default items-center justify-center py-1",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React5.createElement(import_lucide_react2.ChevronDownIcon, { className: "size-4" })
  );
}

// components/ui/primitives/code-block.tsx
var import_lucide_react4 = require("lucide-react");

// hooks/use-copy-to-clipboard.ts
var import_react = require("react");
function useCopyToClipboard(resetDelayMs = 2e3) {
  const [copied, setCopied] = (0, import_react.useState)(false);
  const resetTimerRef = (0, import_react.useRef)(null);
  const clearResetTimer = (0, import_react.useCallback)(() => {
    if (resetTimerRef.current === null) {
      return;
    }
    clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }, []);
  (0, import_react.useEffect)(() => clearResetTimer, [clearResetTimer]);
  const copy = (0, import_react.useCallback)(
    async (value) => {
      if (!value) {
        return false;
      }
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        return false;
      }
      setCopied(true);
      clearResetTimer();
      resetTimerRef.current = setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, resetDelayMs);
      return true;
    },
    [clearResetTimer, resetDelayMs]
  );
  return [copied, copy];
}

// components/ui/primitives/copy-button.tsx
var import_lucide_react3 = require("lucide-react");
function CopyButton({
  text,
  label = "Copy"
}) {
  const [copied, copy] = useCopyToClipboard(1500);
  return /* @__PURE__ */ React.createElement(
    Button,
    {
      className: "h-6 gap-1 px-2 text-[10px] text-muted-foreground",
      onClick: async () => {
        await copy(text);
      },
      size: "sm",
      type: "button",
      variant: "ghost"
    },
    copied ? /* @__PURE__ */ React.createElement(import_lucide_react3.Check, { className: "size-3" }) : /* @__PURE__ */ React.createElement(import_lucide_react3.Copy, { className: "size-3" }),
    copied ? "Copied" : label
  );
}

// components/ui/primitives/code-block.tsx
var toneClasses = {
  default: {
    wrapper: "border-border/70 bg-zinc-950/95",
    chrome: "border-border/60 bg-black/30",
    label: "text-zinc-400"
  },
  danger: {
    wrapper: "border-red-500/25 bg-red-950/20",
    chrome: "border-red-500/20 bg-red-950/25",
    label: "text-red-200"
  },
  success: {
    wrapper: "border-emerald-500/25 bg-emerald-950/20",
    chrome: "border-emerald-500/20 bg-emerald-950/25",
    label: "text-emerald-200"
  }
};
function CodeBlock({
  code,
  children,
  className,
  filename,
  compact = false,
  label,
  tone = "default",
  maxHeight = "24rem",
  showLineNumbers
}) {
  const content = code ?? children ?? "";
  const lines = content.split("\n");
  const gutter = showLineNumbers ?? lines.length >= 4;
  const palette = toneClasses[tone];
  let lineNumber = 1;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `overflow-hidden rounded-xl border shadow-sm ${palette.wrapper} ${className ?? ""}`
    },
    compact ? null : /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `flex items-center justify-between border-b px-3 py-1.5 ${palette.chrome}`
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          className: `flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] ${palette.label}`
        },
        filename ? /* @__PURE__ */ React.createElement(import_lucide_react4.FileCode, { className: "size-3" }) : null,
        /* @__PURE__ */ React.createElement("span", null, filename ?? label ?? "code")
      ),
      /* @__PURE__ */ React.createElement(CopyButton, { text: content })
    ),
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "overflow-auto",
        style: maxHeight ? { maxHeight } : void 0
      },
      gutter ? /* @__PURE__ */ React.createElement("table", { className: "w-full border-collapse font-mono text-[11px] leading-relaxed" }, /* @__PURE__ */ React.createElement("tbody", null, lines.map((line) => {
        const currentLine = lineNumber++;
        return /* @__PURE__ */ React.createElement("tr", { key: `line-${currentLine}-${line.slice(0, 24)}` }, /* @__PURE__ */ React.createElement("td", { className: "w-10 select-none border-border/40 border-r bg-black/15 px-2 text-right text-zinc-500" }, currentLine), /* @__PURE__ */ React.createElement("td", { className: "whitespace-pre-wrap break-words px-3 py-0.5 text-zinc-100" }, line || " "));
      }))) : /* @__PURE__ */ React.createElement("pre", { className: "whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] text-zinc-100 leading-relaxed" }, content)
    )
  );
}

// components/ui/composites/pack-install-dialog.tsx
function PackInstallDialog({
  open,
  pack,
  run,
  onOpenChange,
  onSelectProject,
  onClose,
  onRunCommand,
  onCopyCommand
}) {
  const isComplete = run.state === "complete";
  const projectAwareCommand = run.projectScoped && run.selectedProject ? `cd '${run.selectedProject.replace(/'/g, "'\\''")}' && ${run.command}` : run.command;
  return /* @__PURE__ */ React.createElement(Dialog, { onOpenChange, open }, /* @__PURE__ */ React.createElement(DialogContent, { className: "max-w-3xl" }, /* @__PURE__ */ React.createElement(DialogHeader, null, /* @__PURE__ */ React.createElement(DialogTitle, null, run.action === "install" ? "Install" : "Uninstall", " ", pack.displayName), /* @__PURE__ */ React.createElement(DialogDescription, null, "harness: ", run.harness, run.commandIsAutoDetect ? " \xB7 auto-detect enabled" : "", isComplete && typeof run.exitCode === "number" ? ` \xB7 exit ${run.exitCode}${run.reason ? ` (${run.reason})` : ""}` : "")), /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, run.projectScoped && run.projectOptions?.length ? /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement(Label, { htmlFor: "pack-project" }, "Project"), /* @__PURE__ */ React.createElement(
    Select,
    {
      onValueChange: (value) => onSelectProject?.(value),
      value: run.selectedProject
    },
    /* @__PURE__ */ React.createElement(SelectTrigger, { id: "pack-project" }, /* @__PURE__ */ React.createElement(SelectValue, null)),
    /* @__PURE__ */ React.createElement(SelectContent, null, run.projectOptions.map((project) => /* @__PURE__ */ React.createElement(SelectItem, { key: project, value: project }, project)))
  )) : null, /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("div", { className: "font-medium text-sm" }, "Command preview"), /* @__PURE__ */ React.createElement(CodeBlock, null, projectAwareCommand)), run.lines?.length ? /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("div", { className: "font-medium text-sm" }, "Run output"), /* @__PURE__ */ React.createElement(CodeBlock, null, run.lines.join("\n"))) : null, run.postInstall ? /* @__PURE__ */ React.createElement("div", { className: "rounded-xl border border-border bg-muted/35 p-4" }, /* @__PURE__ */ React.createElement("div", { className: "font-medium text-sm" }, run.postInstall.title), /* @__PURE__ */ React.createElement("p", { className: "mt-2 text-muted-foreground text-sm" }, run.postInstall.body), run.postInstall.copyCommand ? /* @__PURE__ */ React.createElement("div", { className: "mt-3" }, /* @__PURE__ */ React.createElement(CodeBlock, null, run.postInstall.copyCommand)) : null) : null), /* @__PURE__ */ React.createElement(DialogFooter, null, /* @__PURE__ */ React.createElement(Button, { disabled: !onClose, onClick: onClose, variant: "outline" }, "Close"), /* @__PURE__ */ React.createElement(
    Button,
    {
      disabled: run.projectScoped ? !onCopyCommand : !onRunCommand,
      onClick: run.projectScoped ? onCopyCommand : onRunCommand
    },
    run.projectScoped ? "Copy command" : "Run command"
  ))));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PackInstallDialog
});
//# sourceMappingURL=pack-install-dialog.js.map