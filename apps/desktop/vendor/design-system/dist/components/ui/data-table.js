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

// components/ui/data-table.tsx
var data_table_exports = {};
__export(data_table_exports, {
  DataTable: () => DataTable
});
module.exports = __toCommonJS(data_table_exports);
var React5 = __toESM(require("react"));

// components/ui/table.tsx
var React = __toESM(require("react"));

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/table.tsx
function Table({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-slot": "table-container",
      className: "relative w-full overflow-x-auto"
    },
    /* @__PURE__ */ React.createElement(
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
  return /* @__PURE__ */ React.createElement(
    "thead",
    {
      "data-slot": "table-header",
      className: cn("[&_tr]:border-b", className),
      ...props
    }
  );
}
function TableBody({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "tbody",
    {
      "data-slot": "table-body",
      className: cn("[&_tr:last-child]:border-0", className),
      ...props
    }
  );
}
function TableRow({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
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
  return /* @__PURE__ */ React.createElement(
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
  return /* @__PURE__ */ React.createElement(
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

// components/ui/input.tsx
var React2 = __toESM(require("react"));
function Input({ className, type, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "input",
    {
      type,
      "data-slot": "input",
      className: cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground bg-input dark:bg-input border-input-border h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      ),
      ...props
    }
  );
}

// components/ui/select.tsx
var React3 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_lucide_react = require("lucide-react");
function Select({
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(import_radix_ui.Select.Root, { "data-slot": "select", ...props });
}
function SelectValue({
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(import_radix_ui.Select.Value, { "data-slot": "select-value", ...props });
}
function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui.Select.Trigger,
    {
      "data-slot": "select-trigger",
      "data-size": size,
      className: cn(
        "border-input-border data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-input hover:bg-muted dark:bg-input dark:hover:bg-muted flex w-fit items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm whitespace-nowrap transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      ),
      ...props
    },
    children,
    /* @__PURE__ */ React3.createElement(import_radix_ui.Select.Icon, { asChild: true }, /* @__PURE__ */ React3.createElement(import_lucide_react.ChevronDownIcon, { className: "size-4 opacity-50" }))
  );
}
function SelectContent({
  className,
  children,
  position = "popper",
  align = "center",
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(import_radix_ui.Select.Portal, null, /* @__PURE__ */ React3.createElement(
    import_radix_ui.Select.Content,
    {
      "data-slot": "select-content",
      className: cn(
        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
        position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      ),
      position,
      align,
      ...props
    },
    /* @__PURE__ */ React3.createElement(SelectScrollUpButton, null),
    /* @__PURE__ */ React3.createElement(
      import_radix_ui.Select.Viewport,
      {
        className: cn(
          "p-1",
          position === "popper" && "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
        )
      },
      children
    ),
    /* @__PURE__ */ React3.createElement(SelectScrollDownButton, null)
  ));
}
function SelectItem({
  className,
  children,
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui.Select.Item,
    {
      "data-slot": "select-item",
      className: cn(
        "focus:bg-muted focus:text-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React3.createElement("span", { className: "absolute right-2 flex size-3.5 items-center justify-center" }, /* @__PURE__ */ React3.createElement(import_radix_ui.Select.ItemIndicator, null, /* @__PURE__ */ React3.createElement(import_lucide_react.CheckIcon, { className: "size-4" }))),
    /* @__PURE__ */ React3.createElement(import_radix_ui.Select.ItemText, null, children)
  );
}
function SelectScrollUpButton({
  className,
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui.Select.ScrollUpButton,
    {
      "data-slot": "select-scroll-up-button",
      className: cn(
        "flex cursor-default items-center justify-center py-1",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React3.createElement(import_lucide_react.ChevronUpIcon, { className: "size-4" })
  );
}
function SelectScrollDownButton({
  className,
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui.Select.ScrollDownButton,
    {
      "data-slot": "select-scroll-down-button",
      className: cn(
        "flex cursor-default items-center justify-center py-1",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React3.createElement(import_lucide_react.ChevronDownIcon, { className: "size-4" })
  );
}

// components/ui/button.tsx
var React4 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");
var buttonVariants = (0, import_class_variance_authority.cva)(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline: "border border-input-border bg-input hover:bg-muted hover:text-foreground dark:bg-input dark:hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4 gap-2 py-2 has-[>svg]:px-3 [&_svg:not([class*='size-'])]:size-4",
        sm: "h-8 rounded-md gap-2 px-3 has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 rounded-md gap-2 px-6 has-[>svg]:px-4 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-9 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-4"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);
function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? import_radix_ui2.Slot.Slot : "button";
  return /* @__PURE__ */ React4.createElement(
    Comp,
    {
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size, className })),
      ...props
    }
  );
}

// components/ui/data-table.tsx
var import_lucide_react2 = require("lucide-react");
function SortIcon({
  columnKey,
  sortKey,
  sortDir
}) {
  if (sortKey !== columnKey) {
    return /* @__PURE__ */ React5.createElement(import_lucide_react2.ArrowUpDownIcon, { className: "h-3.5 w-3.5 opacity-50" });
  }
  if (sortDir === "asc") {
    return /* @__PURE__ */ React5.createElement(import_lucide_react2.ArrowUpIcon, { className: "h-3.5 w-3.5" });
  }
  return /* @__PURE__ */ React5.createElement(import_lucide_react2.ArrowDownIcon, { className: "h-3.5 w-3.5" });
}
function DataTable({
  data,
  columns,
  searchPlaceholder = "Search...",
  searchKey,
  sortOptions,
  filterOptions,
  filterKey,
  onRowClick,
  rowHref,
  renderRowActions,
  pageSize: initialPageSize = 10,
  pageSizeOptions,
  onPageSizeChange,
  emptyMessage = "No items found."
}) {
  const [search, setSearch] = React5.useState("");
  const [sort, setSort] = React5.useState(sortOptions?.[0]?.value ?? "");
  const [filter, setFilter] = React5.useState("all");
  const [page, setPage] = React5.useState(1);
  const [internalPageSize, setInternalPageSize] = React5.useState(initialPageSize);
  const pageSize = onPageSizeChange ? initialPageSize : internalPageSize;
  const setPageSize = onPageSizeChange ? (size) => onPageSizeChange(size) : setInternalPageSize;
  const filteredData = React5.useMemo(() => {
    let result = [...data];
    if (search && searchKey) {
      const searchLower = search.toLowerCase();
      result = result.filter((item) => {
        const value = item[searchKey];
        if (typeof value === "string") {
          return value.toLowerCase().includes(searchLower);
        }
        return false;
      });
    }
    if (filter !== "all" && filterKey) {
      result = result.filter((item) => {
        const value = item[filterKey];
        return value === filter;
      });
    }
    if (sort) {
      const [sortKey2, sortDir2] = sort.split(":");
      result.sort((a, b) => {
        const aVal = a[sortKey2];
        const bVal = b[sortKey2];
        if (aVal instanceof Date && bVal instanceof Date) {
          return sortDir2 === "desc" ? bVal.getTime() - aVal.getTime() : aVal.getTime() - bVal.getTime();
        }
        if (typeof aVal === "string" && typeof bVal === "string") {
          return sortDir2 === "desc" ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
        }
        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortDir2 === "desc" ? bVal - aVal : aVal - bVal;
        }
        return 0;
      });
    }
    return result;
  }, [data, search, searchKey, filter, filterKey, sort]);
  const totalPages = Math.ceil(filteredData.length / pageSize);
  const paginatedData = filteredData.slice(
    (page - 1) * pageSize,
    page * pageSize
  );
  const [sortKey, sortDir] = sort ? sort.split(":") : [null, null];
  const hasColumnSort = columns.some((c) => c.sortable);
  const handleColumnSort = (columnKey) => {
    if (sortKey === columnKey) {
      setSort(`${columnKey}:${sortDir === "asc" ? "desc" : "asc"}`);
    } else {
      setSort(`${columnKey}:asc`);
    }
  };
  React5.useEffect(() => {
    setPage(1);
  }, [search, filter, sort, pageSize]);
  return /* @__PURE__ */ React5.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React5.createElement("div", { className: "flex items-center gap-4" }, searchKey && /* @__PURE__ */ React5.createElement("div", { className: "relative flex-1 max-w-sm" }, /* @__PURE__ */ React5.createElement(import_lucide_react2.SearchIcon, { className: "absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" }), /* @__PURE__ */ React5.createElement(
    Input,
    {
      placeholder: searchPlaceholder,
      value: search,
      onChange: (e) => setSearch(e.target.value),
      className: "pl-9"
    }
  )), /* @__PURE__ */ React5.createElement("div", { className: "flex items-center gap-2 ml-auto" }, sortOptions && sortOptions.length > 0 && !hasColumnSort && /* @__PURE__ */ React5.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React5.createElement("span", { className: "text-sm text-muted-foreground" }, "Sort:"), /* @__PURE__ */ React5.createElement(Select, { value: sort, onValueChange: setSort }, /* @__PURE__ */ React5.createElement(SelectTrigger, { className: "w-[160px]" }, /* @__PURE__ */ React5.createElement(SelectValue, null)), /* @__PURE__ */ React5.createElement(SelectContent, null, sortOptions.map((option) => /* @__PURE__ */ React5.createElement(SelectItem, { key: option.value, value: option.value }, option.label))))), filterOptions && filterOptions.length > 0 && /* @__PURE__ */ React5.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React5.createElement("span", { className: "text-sm text-muted-foreground" }, "Filter:"), /* @__PURE__ */ React5.createElement(Select, { value: filter, onValueChange: setFilter }, /* @__PURE__ */ React5.createElement(SelectTrigger, { className: "w-[120px]" }, /* @__PURE__ */ React5.createElement(SelectValue, null)), /* @__PURE__ */ React5.createElement(SelectContent, null, /* @__PURE__ */ React5.createElement(SelectItem, { value: "all" }, "All"), filterOptions.map((option) => /* @__PURE__ */ React5.createElement(SelectItem, { key: option.value, value: option.value }, option.label))))))), /* @__PURE__ */ React5.createElement("div", { className: "rounded-md border" }, /* @__PURE__ */ React5.createElement(Table, null, /* @__PURE__ */ React5.createElement(TableHeader, null, /* @__PURE__ */ React5.createElement(TableRow, null, columns.map((column) => /* @__PURE__ */ React5.createElement(TableHead, { key: String(column.key), className: column.className }, column.sortable ? /* @__PURE__ */ React5.createElement(
    "button",
    {
      className: "flex items-center gap-1 hover:text-foreground transition-colors",
      onClick: () => handleColumnSort(String(column.key)),
      type: "button"
    },
    column.header,
    /* @__PURE__ */ React5.createElement(
      SortIcon,
      {
        columnKey: String(column.key),
        sortDir,
        sortKey
      }
    )
  ) : column.header)), renderRowActions && /* @__PURE__ */ React5.createElement(TableHead, { className: "w-[50px]" }))), /* @__PURE__ */ React5.createElement(TableBody, null, paginatedData.length === 0 ? /* @__PURE__ */ React5.createElement(TableRow, null, /* @__PURE__ */ React5.createElement(
    TableCell,
    {
      colSpan: columns.length + (renderRowActions ? 1 : 0),
      className: "h-24 text-center text-muted-foreground"
    },
    emptyMessage
  )) : paginatedData.map((item) => {
    const href = rowHref?.(item);
    return /* @__PURE__ */ React5.createElement(
      TableRow,
      {
        key: item.id,
        onClick: href ? void 0 : (() => onRowClick?.(item)),
        className: cn(
          (onRowClick || href) && "cursor-pointer",
          href && "relative"
        )
      },
      columns.map((column, colIndex) => /* @__PURE__ */ React5.createElement(
        TableCell,
        {
          key: String(column.key),
          className: cn(column.className, href && colIndex > 0 && "relative z-[2]")
        },
        colIndex === 0 && href && /* @__PURE__ */ React5.createElement(
          "a",
          {
            href,
            className: "absolute inset-0 z-[1]",
            onClick: (e) => {
              if (!onRowClick) return;
              const isModified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
              if (e.button === 0 && !isModified) {
                e.preventDefault();
                onRowClick(item);
              }
            },
            tabIndex: -1
          },
          /* @__PURE__ */ React5.createElement("span", { className: "sr-only" }, "Open")
        ),
        column.render ? column.render(item) : String(item[column.key] ?? "")
      )),
      renderRowActions && /* @__PURE__ */ React5.createElement(
        TableCell,
        {
          className: cn(href && "relative z-10"),
          onClick: (e) => e.stopPropagation()
        },
        renderRowActions(item)
      )
    );
  })))), /* @__PURE__ */ React5.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React5.createElement("div", { className: "flex items-center gap-4" }, /* @__PURE__ */ React5.createElement("p", { className: "text-sm text-muted-foreground" }, filteredData.length, " item", filteredData.length !== 1 ? "s" : "", " total"), pageSizeOptions && pageSizeOptions.length > 0 && /* @__PURE__ */ React5.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React5.createElement("span", { className: "text-sm text-muted-foreground" }, "Show:"), /* @__PURE__ */ React5.createElement(
    Select,
    {
      onValueChange: (v) => {
        setPageSize(Number(v));
        setPage(1);
      },
      value: String(pageSize)
    },
    /* @__PURE__ */ React5.createElement(SelectTrigger, { className: "w-[80px]" }, /* @__PURE__ */ React5.createElement(SelectValue, null)),
    /* @__PURE__ */ React5.createElement(SelectContent, null, pageSizeOptions.map((size) => /* @__PURE__ */ React5.createElement(SelectItem, { key: size, value: String(size) }, size)))
  ))), totalPages > 1 && /* @__PURE__ */ React5.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React5.createElement(
    Button,
    {
      variant: "outline",
      size: "sm",
      onClick: () => setPage((p) => Math.max(1, p - 1)),
      disabled: page === 1
    },
    /* @__PURE__ */ React5.createElement(import_lucide_react2.ChevronLeftIcon, { className: "h-4 w-4" })
  ), /* @__PURE__ */ React5.createElement("span", { className: "text-sm" }, "Page ", page, " of ", totalPages), /* @__PURE__ */ React5.createElement(
    Button,
    {
      variant: "outline",
      size: "sm",
      onClick: () => setPage((p) => Math.min(totalPages, p + 1)),
      disabled: page === totalPages
    },
    /* @__PURE__ */ React5.createElement(import_lucide_react2.ChevronRightIcon, { className: "h-4 w-4" })
  ))));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DataTable
});
//# sourceMappingURL=data-table.js.map