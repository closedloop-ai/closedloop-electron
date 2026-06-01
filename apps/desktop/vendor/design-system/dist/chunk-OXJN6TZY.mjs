import React from "react";
import {
  CopyButton
} from "./chunk-L5AZJM2L.mjs";

// components/ui/primitives/terminal-block.tsx
import { Terminal } from "lucide-react";
function TerminalBlock({
  command,
  description,
  label = "terminal",
  text,
  stream
}) {
  const body = text ?? [description ? `# ${description}` : null, command ? `$ ${command}` : null].filter(Boolean).join("\n");
  const isErrorStream = stream === "stderr";
  return /* @__PURE__ */ React.createElement("div", { className: "overflow-hidden rounded-xl border border-border/70 bg-zinc-950/95 shadow-sm" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between border-border/60 border-b bg-black/30 px-3 py-1.5" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1.5 text-[10px] text-zinc-400 uppercase tracking-[0.12em]" }, /* @__PURE__ */ React.createElement(Terminal, { className: "size-3" }), /* @__PURE__ */ React.createElement("span", null, stream ?? label)), /* @__PURE__ */ React.createElement(CopyButton, { label: "Copy", text: body })), /* @__PURE__ */ React.createElement(
    "pre",
    {
      className: `max-h-96 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed ${isErrorStream ? "text-red-200" : "text-zinc-100"}`
    },
    body
  ));
}

export {
  TerminalBlock
};
//# sourceMappingURL=chunk-OXJN6TZY.mjs.map