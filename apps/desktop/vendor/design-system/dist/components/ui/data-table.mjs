"use client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../chunk-XQL5M77A.mjs";
import {
  Input
} from "../../chunk-J7MGMQSF.mjs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../chunk-PWY5AK4F.mjs";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/data-table.tsx
import * as React from "react";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon
} from "lucide-react";
function SortIcon({
  columnKey,
  sortKey,
  sortDir
}) {
  if (sortKey !== columnKey) {
    return /* @__PURE__ */ React.createElement(ArrowUpDownIcon, { className: "h-3.5 w-3.5 opacity-50" });
  }
  if (sortDir === "asc") {
    return /* @__PURE__ */ React.createElement(ArrowUpIcon, { className: "h-3.5 w-3.5" });
  }
  return /* @__PURE__ */ React.createElement(ArrowDownIcon, { className: "h-3.5 w-3.5" });
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
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState(sortOptions?.[0]?.value ?? "");
  const [filter, setFilter] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [internalPageSize, setInternalPageSize] = React.useState(initialPageSize);
  const pageSize = onPageSizeChange ? initialPageSize : internalPageSize;
  const setPageSize = onPageSizeChange ? (size) => onPageSizeChange(size) : setInternalPageSize;
  const filteredData = React.useMemo(() => {
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
  React.useEffect(() => {
    setPage(1);
  }, [search, filter, sort, pageSize]);
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-4" }, searchKey && /* @__PURE__ */ React.createElement("div", { className: "relative flex-1 max-w-sm" }, /* @__PURE__ */ React.createElement(SearchIcon, { className: "absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" }), /* @__PURE__ */ React.createElement(
    Input,
    {
      placeholder: searchPlaceholder,
      value: search,
      onChange: (e) => setSearch(e.target.value),
      className: "pl-9"
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 ml-auto" }, sortOptions && sortOptions.length > 0 && !hasColumnSort && /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-sm text-muted-foreground" }, "Sort:"), /* @__PURE__ */ React.createElement(Select, { value: sort, onValueChange: setSort }, /* @__PURE__ */ React.createElement(SelectTrigger, { className: "w-[160px]" }, /* @__PURE__ */ React.createElement(SelectValue, null)), /* @__PURE__ */ React.createElement(SelectContent, null, sortOptions.map((option) => /* @__PURE__ */ React.createElement(SelectItem, { key: option.value, value: option.value }, option.label))))), filterOptions && filterOptions.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-sm text-muted-foreground" }, "Filter:"), /* @__PURE__ */ React.createElement(Select, { value: filter, onValueChange: setFilter }, /* @__PURE__ */ React.createElement(SelectTrigger, { className: "w-[120px]" }, /* @__PURE__ */ React.createElement(SelectValue, null)), /* @__PURE__ */ React.createElement(SelectContent, null, /* @__PURE__ */ React.createElement(SelectItem, { value: "all" }, "All"), filterOptions.map((option) => /* @__PURE__ */ React.createElement(SelectItem, { key: option.value, value: option.value }, option.label))))))), /* @__PURE__ */ React.createElement("div", { className: "rounded-md border" }, /* @__PURE__ */ React.createElement(Table, null, /* @__PURE__ */ React.createElement(TableHeader, null, /* @__PURE__ */ React.createElement(TableRow, null, columns.map((column) => /* @__PURE__ */ React.createElement(TableHead, { key: String(column.key), className: column.className }, column.sortable ? /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "flex items-center gap-1 hover:text-foreground transition-colors",
      onClick: () => handleColumnSort(String(column.key)),
      type: "button"
    },
    column.header,
    /* @__PURE__ */ React.createElement(
      SortIcon,
      {
        columnKey: String(column.key),
        sortDir,
        sortKey
      }
    )
  ) : column.header)), renderRowActions && /* @__PURE__ */ React.createElement(TableHead, { className: "w-[50px]" }))), /* @__PURE__ */ React.createElement(TableBody, null, paginatedData.length === 0 ? /* @__PURE__ */ React.createElement(TableRow, null, /* @__PURE__ */ React.createElement(
    TableCell,
    {
      colSpan: columns.length + (renderRowActions ? 1 : 0),
      className: "h-24 text-center text-muted-foreground"
    },
    emptyMessage
  )) : paginatedData.map((item) => {
    const href = rowHref?.(item);
    return /* @__PURE__ */ React.createElement(
      TableRow,
      {
        key: item.id,
        onClick: href ? void 0 : (() => onRowClick?.(item)),
        className: cn(
          (onRowClick || href) && "cursor-pointer",
          href && "relative"
        )
      },
      columns.map((column, colIndex) => /* @__PURE__ */ React.createElement(
        TableCell,
        {
          key: String(column.key),
          className: cn(column.className, href && colIndex > 0 && "relative z-[2]")
        },
        colIndex === 0 && href && /* @__PURE__ */ React.createElement(
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
          /* @__PURE__ */ React.createElement("span", { className: "sr-only" }, "Open")
        ),
        column.render ? column.render(item) : String(item[column.key] ?? "")
      )),
      renderRowActions && /* @__PURE__ */ React.createElement(
        TableCell,
        {
          className: cn(href && "relative z-10"),
          onClick: (e) => e.stopPropagation()
        },
        renderRowActions(item)
      )
    );
  })))), /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-4" }, /* @__PURE__ */ React.createElement("p", { className: "text-sm text-muted-foreground" }, filteredData.length, " item", filteredData.length !== 1 ? "s" : "", " total"), pageSizeOptions && pageSizeOptions.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-sm text-muted-foreground" }, "Show:"), /* @__PURE__ */ React.createElement(
    Select,
    {
      onValueChange: (v) => {
        setPageSize(Number(v));
        setPage(1);
      },
      value: String(pageSize)
    },
    /* @__PURE__ */ React.createElement(SelectTrigger, { className: "w-[80px]" }, /* @__PURE__ */ React.createElement(SelectValue, null)),
    /* @__PURE__ */ React.createElement(SelectContent, null, pageSizeOptions.map((size) => /* @__PURE__ */ React.createElement(SelectItem, { key: size, value: String(size) }, size)))
  ))), totalPages > 1 && /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement(
    Button,
    {
      variant: "outline",
      size: "sm",
      onClick: () => setPage((p) => Math.max(1, p - 1)),
      disabled: page === 1
    },
    /* @__PURE__ */ React.createElement(ChevronLeftIcon, { className: "h-4 w-4" })
  ), /* @__PURE__ */ React.createElement("span", { className: "text-sm" }, "Page ", page, " of ", totalPages), /* @__PURE__ */ React.createElement(
    Button,
    {
      variant: "outline",
      size: "sm",
      onClick: () => setPage((p) => Math.min(totalPages, p + 1)),
      disabled: page === totalPages
    },
    /* @__PURE__ */ React.createElement(ChevronRightIcon, { className: "h-4 w-4" })
  ))));
}
export {
  DataTable
};
//# sourceMappingURL=data-table.mjs.map