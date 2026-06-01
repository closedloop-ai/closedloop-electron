import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/radio-group.tsx
import * as React from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { CircleIcon } from "lucide-react";
function RadioGroup({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    RadioGroupPrimitive.Root,
    {
      "data-slot": "radio-group",
      className: cn("grid gap-3", className),
      ...props
    }
  );
}
function RadioGroupItem({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    RadioGroupPrimitive.Item,
    {
      "data-slot": "radio-group-item",
      className: cn(
        "border-input-border text-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-input dark:bg-input aspect-square size-4 shrink-0 rounded-full border shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React.createElement(
      RadioGroupPrimitive.Indicator,
      {
        "data-slot": "radio-group-indicator",
        className: "relative flex items-center justify-center"
      },
      /* @__PURE__ */ React.createElement(CircleIcon, { className: "fill-primary absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2" })
    )
  );
}

export {
  RadioGroup,
  RadioGroupItem
};
//# sourceMappingURL=chunk-5TBN72QF.mjs.map