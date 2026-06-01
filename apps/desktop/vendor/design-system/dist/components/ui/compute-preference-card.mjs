import React from "react";
"use client";
import {
  RadioGroup,
  RadioGroupItem
} from "../../chunk-5TBN72QF.mjs";
import {
  Label
} from "../../chunk-U7KVRX5X.mjs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../chunk-ZKMGHYX7.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/compute-preference-card.tsx
import { Loader2Icon } from "lucide-react";
function ComputePreferenceCard({
  title,
  description,
  headerIcon,
  isLoading = false,
  disabled = false,
  value,
  onValueChange,
  options
}) {
  return /* @__PURE__ */ React.createElement(Card, null, /* @__PURE__ */ React.createElement(CardHeader, null, /* @__PURE__ */ React.createElement(CardTitle, { className: "flex items-center gap-2" }, headerIcon, title), /* @__PURE__ */ React.createElement(CardDescription, null, description)), /* @__PURE__ */ React.createElement(CardContent, null, isLoading ? /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-center py-4" }, /* @__PURE__ */ React.createElement(Loader2Icon, { className: "h-6 w-6 animate-spin text-muted-foreground" })) : /* @__PURE__ */ React.createElement(
    RadioGroup,
    {
      className: "gap-3",
      disabled,
      onValueChange,
      value: value ?? ""
    },
    options.map((option) => {
      const id = `compute-preference-${option.value}`;
      return /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3", key: option.value }, /* @__PURE__ */ React.createElement(RadioGroupItem, { id, value: option.value }), /* @__PURE__ */ React.createElement(
        Label,
        {
          className: "flex cursor-pointer items-center gap-2",
          htmlFor: id
        },
        option.icon,
        /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "font-medium" }, option.label), /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-xs" }, option.description))
      ));
    })
  )));
}
export {
  ComputePreferenceCard
};
//# sourceMappingURL=compute-preference-card.mjs.map