import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/textarea.tsx
import * as React from "react";
function Textarea({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "textarea",
    {
      "data-slot": "textarea",
      className: cn(
        "border-input-border placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-input dark:bg-input flex field-sizing-content min-h-16 w-full rounded-md border px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      ),
      ...props
    }
  );
}

export {
  Textarea
};
//# sourceMappingURL=chunk-64QT2WSE.mjs.map