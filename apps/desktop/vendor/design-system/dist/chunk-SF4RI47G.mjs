import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/checkbox.tsx
import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { CheckIcon, MinusIcon } from "lucide-react";
function Checkbox({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    CheckboxPrimitive.Root,
    {
      "data-slot": "checkbox",
      className: cn(
        "group/checkbox peer border-input-border bg-input dark:bg-input data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React.createElement(
      CheckboxPrimitive.Indicator,
      {
        "data-slot": "checkbox-indicator",
        className: "grid place-content-center text-current transition-none"
      },
      /* @__PURE__ */ React.createElement(CheckIcon, { className: "size-3 group-data-[state=indeterminate]/checkbox:hidden", strokeWidth: 3 }),
      /* @__PURE__ */ React.createElement(MinusIcon, { className: "hidden size-3 group-data-[state=indeterminate]/checkbox:block", strokeWidth: 3 })
    )
  );
}

export {
  Checkbox
};
//# sourceMappingURL=chunk-SF4RI47G.mjs.map