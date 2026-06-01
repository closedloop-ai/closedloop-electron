import React from "react";
import {
  Button
} from "./chunk-TT7DUYOP.mjs";
import {
  useCopyToClipboard
} from "./chunk-JHIJKM5E.mjs";

// components/ui/primitives/copy-button.tsx
import { Check, Copy } from "lucide-react";
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
    copied ? /* @__PURE__ */ React.createElement(Check, { className: "size-3" }) : /* @__PURE__ */ React.createElement(Copy, { className: "size-3" }),
    copied ? "Copied" : label
  );
}

export {
  CopyButton
};
//# sourceMappingURL=chunk-L5AZJM2L.mjs.map