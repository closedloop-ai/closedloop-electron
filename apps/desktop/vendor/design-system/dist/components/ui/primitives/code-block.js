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

// components/ui/primitives/code-block.tsx
var code_block_exports = {};
__export(code_block_exports, {
  CodeBlock: () => CodeBlock
});
module.exports = __toCommonJS(code_block_exports);
var import_lucide_react2 = require("lucide-react");

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
var import_lucide_react = require("lucide-react");
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
    copied ? /* @__PURE__ */ React.createElement(import_lucide_react.Check, { className: "size-3" }) : /* @__PURE__ */ React.createElement(import_lucide_react.Copy, { className: "size-3" }),
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
        filename ? /* @__PURE__ */ React.createElement(import_lucide_react2.FileCode, { className: "size-3" }) : null,
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CodeBlock
});
//# sourceMappingURL=code-block.js.map