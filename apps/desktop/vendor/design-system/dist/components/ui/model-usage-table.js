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

// components/ui/model-usage-table.tsx
var model_usage_table_exports = {};
__export(model_usage_table_exports, {
  ModelUsageTable: () => ModelUsageTable
});
module.exports = __toCommonJS(model_usage_table_exports);

// components/ui/empty.tsx
var import_class_variance_authority = require("class-variance-authority");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/empty.tsx
function Empty({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty",
      className: cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg border-dashed p-6 text-center text-balance md:p-12",
        className
      ),
      ...props
    }
  );
}
function EmptyHeader({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-header",
      className: cn(
        "flex max-w-sm flex-col items-center gap-2 text-center",
        className
      ),
      ...props
    }
  );
}
var emptyMediaVariants = (0, import_class_variance_authority.cva)(
  "flex shrink-0 items-center justify-center mb-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg:not([class*='size-'])]:size-6"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);
function EmptyMedia({
  className,
  variant = "default",
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-icon",
      "data-variant": variant,
      className: cn(emptyMediaVariants({ variant, className })),
      ...props
    }
  );
}
function EmptyTitle({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-title",
      className: cn("text-lg font-medium tracking-tight", className),
      ...props
    }
  );
}
function EmptyDescription({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-description",
      className: cn(
        "text-muted-foreground [&>a:hover]:text-primary text-sm/relaxed [&>a]:underline [&>a]:underline-offset-4",
        className
      ),
      ...props
    }
  );
}
function EmptyContent({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "empty-content",
      className: cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance",
        className
      ),
      ...props
    }
  );
}

// components/ui/empty-state.tsx
function EmptyState({
  icon: Icon,
  title,
  description,
  className,
  action
}) {
  return /* @__PURE__ */ React.createElement(Empty, { className: cn("py-12", className) }, /* @__PURE__ */ React.createElement(EmptyHeader, null, /* @__PURE__ */ React.createElement(EmptyMedia, { variant: "icon" }, /* @__PURE__ */ React.createElement(Icon, { className: "size-6" })), /* @__PURE__ */ React.createElement(EmptyTitle, null, title), description ? /* @__PURE__ */ React.createElement(EmptyDescription, null, description) : null), action ? /* @__PURE__ */ React.createElement(EmptyContent, null, action) : null);
}

// components/ui/table.tsx
var React2 = __toESM(require("react"));
function Table({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "div",
    {
      "data-slot": "table-container",
      className: "relative w-full overflow-x-auto"
    },
    /* @__PURE__ */ React2.createElement(
      "table",
      {
        "data-slot": "table",
        className: cn("w-full caption-bottom text-sm", className),
        ...props
      }
    )
  );
}
function TableHeader({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "thead",
    {
      "data-slot": "table-header",
      className: cn("[&_tr]:border-b", className),
      ...props
    }
  );
}
function TableBody({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "tbody",
    {
      "data-slot": "table-body",
      className: cn("[&_tr:last-child]:border-0", className),
      ...props
    }
  );
}
function TableRow({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "tr",
    {
      "data-slot": "table-row",
      className: cn(
        "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        className
      ),
      ...props
    }
  );
}
function TableHead({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "th",
    {
      "data-slot": "table-head",
      className: cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      ),
      ...props
    }
  );
}
function TableCell({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "td",
    {
      "data-slot": "table-cell",
      className: cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      ),
      ...props
    }
  );
}

// components/ui/model-usage-table.tsx
var import_lucide_react = require("lucide-react");
function ModelUsageTable({ rows }) {
  if (rows.length === 0) {
    return /* @__PURE__ */ React.createElement(
      EmptyState,
      {
        className: "py-8",
        description: "Adjust the selected filters to see model usage.",
        icon: import_lucide_react.Activity,
        title: "No model usage"
      }
    );
  }
  return /* @__PURE__ */ React.createElement(Table, null, /* @__PURE__ */ React.createElement(TableHeader, null, /* @__PURE__ */ React.createElement(TableRow, null, /* @__PURE__ */ React.createElement(TableHead, null, "Model"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Sessions"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Input"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Output"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Cache"), /* @__PURE__ */ React.createElement(TableHead, { className: "text-right" }, "Cost"))), /* @__PURE__ */ React.createElement(TableBody, null, rows.map((row) => /* @__PURE__ */ React.createElement(TableRow, { key: row.model }, /* @__PURE__ */ React.createElement(TableCell, { className: "font-medium" }, row.model), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.sessions), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.input), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.output), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.cache), /* @__PURE__ */ React.createElement(TableCell, { className: "text-right" }, row.cost)))));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ModelUsageTable
});
//# sourceMappingURL=model-usage-table.js.map