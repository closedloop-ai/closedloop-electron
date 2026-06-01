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

// components/ui/compute-preference-card.tsx
var compute_preference_card_exports = {};
__export(compute_preference_card_exports, {
  ComputePreferenceCard: () => ComputePreferenceCard
});
module.exports = __toCommonJS(compute_preference_card_exports);

// components/ui/card.tsx
var React2 = __toESM(require("react"));

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/card.tsx
function Card({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "div",
    {
      "data-slot": "card",
      className: cn(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
        className
      ),
      ...props
    }
  );
}
function CardHeader({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "div",
    {
      "data-slot": "card-header",
      className: cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      ),
      ...props
    }
  );
}
function CardTitle({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "div",
    {
      "data-slot": "card-title",
      className: cn("leading-none font-semibold", className),
      ...props
    }
  );
}
function CardDescription({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "div",
    {
      "data-slot": "card-description",
      className: cn("text-muted-foreground text-sm", className),
      ...props
    }
  );
}
function CardContent({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "div",
    {
      "data-slot": "card-content",
      className: cn("px-6", className),
      ...props
    }
  );
}

// components/ui/label.tsx
var React3 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
function Label({
  className,
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui.Label.Root,
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

// components/ui/radio-group.tsx
var React4 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_lucide_react = require("lucide-react");
function RadioGroup({
  className,
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(
    import_radix_ui2.RadioGroup.Root,
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
  return /* @__PURE__ */ React4.createElement(
    import_radix_ui2.RadioGroup.Item,
    {
      "data-slot": "radio-group-item",
      className: cn(
        "border-input-border text-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-input dark:bg-input aspect-square size-4 shrink-0 rounded-full border shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React4.createElement(
      import_radix_ui2.RadioGroup.Indicator,
      {
        "data-slot": "radio-group-indicator",
        className: "relative flex items-center justify-center"
      },
      /* @__PURE__ */ React4.createElement(import_lucide_react.CircleIcon, { className: "fill-primary absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2" })
    )
  );
}

// components/ui/compute-preference-card.tsx
var import_lucide_react2 = require("lucide-react");
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
  return /* @__PURE__ */ React.createElement(Card, null, /* @__PURE__ */ React.createElement(CardHeader, null, /* @__PURE__ */ React.createElement(CardTitle, { className: "flex items-center gap-2" }, headerIcon, title), /* @__PURE__ */ React.createElement(CardDescription, null, description)), /* @__PURE__ */ React.createElement(CardContent, null, isLoading ? /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-center py-4" }, /* @__PURE__ */ React.createElement(import_lucide_react2.Loader2Icon, { className: "h-6 w-6 animate-spin text-muted-foreground" })) : /* @__PURE__ */ React.createElement(
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ComputePreferenceCard
});
//# sourceMappingURL=compute-preference-card.js.map