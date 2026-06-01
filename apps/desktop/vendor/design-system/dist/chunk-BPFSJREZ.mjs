import React from "react";
import {
  CopyButton
} from "./chunk-L5AZJM2L.mjs";

// components/ui/primitives/code-block.tsx
import { FileCode } from "lucide-react";
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
        filename ? /* @__PURE__ */ React.createElement(FileCode, { className: "size-3" }) : null,
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

export {
  CodeBlock
};
//# sourceMappingURL=chunk-BPFSJREZ.mjs.map