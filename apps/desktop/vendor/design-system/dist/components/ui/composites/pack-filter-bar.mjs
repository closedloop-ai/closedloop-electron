import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../chunk-XQL5M77A.mjs";
import {
  Input
} from "../../../chunk-J7MGMQSF.mjs";
import {
  Label
} from "../../../chunk-U7KVRX5X.mjs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../../chunk-ZKMGHYX7.mjs";
import "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/composites/pack-filter-bar.tsx
function PackFilterBar({
  query = "",
  harness = "all",
  harnesses,
  onQueryChange,
  onHarnessChange,
  title = "Discover",
  description = "Filter the shared pack catalog before opening detail or install flows."
}) {
  return /* @__PURE__ */ React.createElement(Card, null, /* @__PURE__ */ React.createElement(CardHeader, null, /* @__PURE__ */ React.createElement(CardTitle, null, title), /* @__PURE__ */ React.createElement(CardDescription, null, description)), /* @__PURE__ */ React.createElement(CardContent, { className: "grid gap-3 md:grid-cols-[1fr_12rem]" }, /* @__PURE__ */ React.createElement("label", { className: "space-y-2" }, /* @__PURE__ */ React.createElement(Label, null, "Search packs"), /* @__PURE__ */ React.createElement(
    Input,
    {
      onChange: (event) => onQueryChange?.(event.target.value),
      placeholder: "Search by name, id, or description",
      value: query
    }
  )), /* @__PURE__ */ React.createElement("label", { className: "space-y-2" }, /* @__PURE__ */ React.createElement(Label, null, "Harness"), /* @__PURE__ */ React.createElement(Select, { onValueChange: onHarnessChange, value: harness }, /* @__PURE__ */ React.createElement(SelectTrigger, null, /* @__PURE__ */ React.createElement(SelectValue, null)), /* @__PURE__ */ React.createElement(SelectContent, null, /* @__PURE__ */ React.createElement(SelectItem, { value: "all" }, "All harnesses"), harnesses.map((option) => /* @__PURE__ */ React.createElement(SelectItem, { key: option, value: option }, option)))))));
}
export {
  PackFilterBar
};
//# sourceMappingURL=pack-filter-bar.mjs.map