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

// components/ui/integration-connection-card.tsx
var integration_connection_card_exports = {};
__export(integration_connection_card_exports, {
  IntegrationConnectionCard: () => IntegrationConnectionCard
});
module.exports = __toCommonJS(integration_connection_card_exports);

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

// components/ui/integration-connection-card.tsx
var import_lucide_react = require("lucide-react");
function IntegrationConnectionCard({
  title,
  description,
  titleIcon,
  isLoading = false,
  className,
  banner,
  statusIcon,
  statusTitle,
  statusDescription,
  actions,
  children
}) {
  return /* @__PURE__ */ React.createElement(Card, { className }, /* @__PURE__ */ React.createElement(CardHeader, null, /* @__PURE__ */ React.createElement(CardTitle, { className: "flex items-center gap-2" }, titleIcon, title), /* @__PURE__ */ React.createElement(CardDescription, null, description)), /* @__PURE__ */ React.createElement(CardContent, null, isLoading ? /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-center py-4" }, /* @__PURE__ */ React.createElement(import_lucide_react.Loader2Icon, { className: "h-6 w-6 animate-spin text-muted-foreground" })) : /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, banner, statusTitle || actions ? /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3" }, statusIcon, /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, statusTitle ? /* @__PURE__ */ React.createElement("p", { className: "font-medium" }, statusTitle) : null, statusDescription ? /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "text-muted-foreground text-sm",
        !statusTitle && "text-foreground"
      )
    },
    statusDescription
  ) : null)), actions ? /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 flex-wrap items-center gap-2 sm:justify-end" }, actions) : null) : null, children)));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  IntegrationConnectionCard
});
//# sourceMappingURL=integration-connection-card.js.map