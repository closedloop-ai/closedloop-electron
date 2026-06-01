import React from "react";
"use client";
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
  Chip
} from "../../../chunk-TX5PRGT7.mjs";
import {
  Button,
  buttonVariants
} from "../../../chunk-TT7DUYOP.mjs";
import {
  cn
} from "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/pagination.tsx
import * as React2 from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon
} from "lucide-react";
function Pagination({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "nav",
    {
      role: "navigation",
      "aria-label": "pagination",
      "data-slot": "pagination",
      className: cn("mx-auto flex w-full justify-center", className),
      ...props
    }
  );
}
function PaginationContent({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    "ul",
    {
      "data-slot": "pagination-content",
      className: cn("flex flex-row items-center gap-1", className),
      ...props
    }
  );
}
function PaginationItem({ ...props }) {
  return /* @__PURE__ */ React2.createElement("li", { "data-slot": "pagination-item", ...props });
}
function PaginationLink({
  className,
  isActive,
  size = "icon",
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    "a",
    {
      "aria-current": isActive ? "page" : void 0,
      "data-slot": "pagination-link",
      "data-active": isActive,
      className: cn(
        buttonVariants({
          variant: isActive ? "outline" : "ghost",
          size
        }),
        className
      ),
      ...props
    }
  );
}
function PaginationPrevious({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    PaginationLink,
    {
      "aria-label": "Go to previous page",
      size: "default",
      className: cn("gap-1 px-2.5 sm:pl-2.5", className),
      ...props
    },
    /* @__PURE__ */ React2.createElement(ChevronLeftIcon, null),
    /* @__PURE__ */ React2.createElement("span", { className: "hidden sm:block" }, "Previous")
  );
}
function PaginationNext({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    PaginationLink,
    {
      "aria-label": "Go to next page",
      size: "default",
      className: cn("gap-1 px-2.5 sm:pr-2.5", className),
      ...props
    },
    /* @__PURE__ */ React2.createElement("span", { className: "hidden sm:block" }, "Next"),
    /* @__PURE__ */ React2.createElement(ChevronRightIcon, null)
  );
}

// components/ui/composites/sessions-controls.tsx
import {
  ArrowDown,
  ArrowUp,
  RefreshCw,
  Search,
  Wifi,
  WifiOff
} from "lucide-react";
function FilterPillGroup({
  options,
  value,
  disabled,
  onValueChange
}) {
  return /* @__PURE__ */ React.createElement("div", { className: "flex min-w-max gap-1 rounded-lg border border-border bg-background p-1" }, options.map((option) => {
    const selected = (value || "") === option.value;
    return /* @__PURE__ */ React.createElement(
      Button,
      {
        className: "h-8 rounded-md px-3 text-xs",
        disabled,
        key: option.value || "__all__",
        onClick: () => onValueChange?.(option.value),
        variant: selected ? "secondary" : "ghost"
      },
      option.label
    );
  }));
}
function SessionsControls({
  controls,
  pagination,
  onSearchValueChange,
  onDirectoryValueChange,
  onSortValueChange,
  onSortDirectionChange,
  onRefresh,
  onHarnessValueChange,
  onStatusValueChange,
  onPageChange
}) {
  const showingFrom = pagination.total === 0 ? 0 : pagination.page * pagination.pageSize + 1;
  const showingTo = Math.min(
    (pagination.page + 1) * pagination.pageSize,
    pagination.total
  );
  const searchDisabled = !onSearchValueChange;
  const directoryDisabled = !onDirectoryValueChange;
  const sortValueDisabled = !onSortValueChange;
  const harnessDisabled = !onHarnessValueChange;
  const statusDisabled = !onStatusValueChange;
  const pageNavigationDisabled = !onPageChange;
  const previousDisabled = pageNavigationDisabled || pagination.page === 0;
  const nextDisabled = pageNavigationDisabled || pagination.page >= pagination.totalPages - 1;
  const disabledPaginationClassName = "pointer-events-none opacity-50";
  const hasHeader = controls.title || controls.countLabel;
  const sessionCountLabel = controls.countLabel || `${pagination.total.toLocaleString()} sessions`;
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-4 rounded-2xl border border-border bg-card/80 p-4 shadow-sm" }, hasHeader ? /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-start justify-between gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, controls.title ? /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("h3", { className: "font-semibold text-foreground text-lg" }, controls.title), /* @__PURE__ */ React.createElement(
    "span",
    {
      className: cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        controls.isLive ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : "border-border bg-muted/40 text-muted-foreground"
      )
    },
    controls.isLive ? /* @__PURE__ */ React.createElement(Wifi, { className: "size-3.5" }) : /* @__PURE__ */ React.createElement(WifiOff, { className: "size-3.5" }),
    controls.isLive ? controls.liveLabel || "Live" : controls.offlineLabel || "Offline"
  )) : null, /* @__PURE__ */ React.createElement("p", { className: "text-sm text-muted-foreground" }, sessionCountLabel)), /* @__PURE__ */ React.createElement(
    Button,
    {
      className: "shrink-0",
      disabled: !onRefresh,
      onClick: onRefresh,
      variant: "outline"
    },
    /* @__PURE__ */ React.createElement(RefreshCw, { className: "size-4" }),
    controls.refreshLabel || "Refresh"
  )) : null, /* @__PURE__ */ React.createElement("div", { className: "rounded-xl border border-border/70 bg-background/70 p-2" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-3 lg:flex-nowrap" }, /* @__PURE__ */ React.createElement("div", { className: "relative min-w-[18rem] flex-1" }, /* @__PURE__ */ React.createElement(Search, { className: "absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" }), /* @__PURE__ */ React.createElement(
    Input,
    {
      className: "pl-9",
      disabled: searchDisabled,
      onChange: (event) => onSearchValueChange?.(event.target.value),
      placeholder: controls.searchPlaceholder,
      readOnly: searchDisabled,
      value: controls.searchValue || ""
    }
  )), /* @__PURE__ */ React.createElement(
    Select,
    {
      disabled: directoryDisabled,
      onValueChange: (value) => onDirectoryValueChange?.(value === "__all__" ? "" : value),
      value: controls.directoryValue || "__all__"
    },
    /* @__PURE__ */ React.createElement(SelectTrigger, { className: "min-w-[13rem] lg:w-[15rem]" }, /* @__PURE__ */ React.createElement(SelectValue, { placeholder: "Directory" })),
    /* @__PURE__ */ React.createElement(SelectContent, null, controls.directoryOptions.map((option) => /* @__PURE__ */ React.createElement(
      SelectItem,
      {
        key: option.value || "__all__",
        value: option.value || "__all__"
      },
      option.label
    )))
  ), /* @__PURE__ */ React.createElement("div", { className: "flex min-w-[16rem] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5" }, /* @__PURE__ */ React.createElement(
    Select,
    {
      disabled: sortValueDisabled,
      onValueChange: onSortValueChange,
      value: controls.sortValue || "time"
    },
    /* @__PURE__ */ React.createElement(SelectTrigger, { className: "h-auto flex-1 border-0 bg-transparent px-1 py-0 shadow-none focus:ring-0" }, /* @__PURE__ */ React.createElement(SelectValue, null)),
    /* @__PURE__ */ React.createElement(SelectContent, null, controls.sortOptions.map((option) => /* @__PURE__ */ React.createElement(SelectItem, { key: option.value, value: option.value }, option.label)))
  ), /* @__PURE__ */ React.createElement("div", { className: "h-4 w-px bg-border" }), /* @__PURE__ */ React.createElement(
    Button,
    {
      className: "shrink-0",
      disabled: !onSortDirectionChange,
      onClick: () => onSortDirectionChange?.(!controls.sortDescending),
      size: "icon",
      variant: "ghost"
    },
    controls.sortDescending ? /* @__PURE__ */ React.createElement(ArrowDown, { className: "size-4" }) : /* @__PURE__ */ React.createElement(ArrowUp, { className: "size-4" })
  ))), /* @__PURE__ */ React.createElement("div", { className: "mt-3 flex flex-col gap-3 overflow-x-auto pb-1 xl:flex-row xl:items-center" }, /* @__PURE__ */ React.createElement(
    FilterPillGroup,
    {
      disabled: harnessDisabled,
      onValueChange: onHarnessValueChange,
      options: controls.harnessOptions,
      value: controls.harnessValue
    }
  ), /* @__PURE__ */ React.createElement(
    FilterPillGroup,
    {
      disabled: statusDisabled,
      onValueChange: onStatusValueChange,
      options: controls.statusOptions,
      value: controls.statusValue
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-3 border-border/70 border-t pt-4 lg:flex-row lg:items-center lg:justify-between" }, /* @__PURE__ */ React.createElement(Chip, { variant: "muted" }, "Showing ", showingFrom, "-", showingTo, " of ", pagination.total), /* @__PURE__ */ React.createElement(Pagination, { className: "mx-0 w-auto justify-start lg:justify-end" }, /* @__PURE__ */ React.createElement(PaginationContent, null, /* @__PURE__ */ React.createElement(PaginationItem, null, /* @__PURE__ */ React.createElement(
    PaginationPrevious,
    {
      "aria-disabled": previousDisabled,
      className: previousDisabled ? disabledPaginationClassName : void 0,
      href: "#",
      onClick: (event) => {
        event.preventDefault();
        if (pagination.page > 0) {
          onPageChange?.(pagination.page - 1);
        }
      },
      tabIndex: previousDisabled ? -1 : void 0
    }
  )), Array.from(
    { length: Math.min(pagination.totalPages, 5) },
    (_, index) => {
      const pageNumber = index + 1;
      return /* @__PURE__ */ React.createElement(PaginationItem, { key: `sessions-page-${pageNumber}` }, /* @__PURE__ */ React.createElement(
        PaginationLink,
        {
          "aria-disabled": pageNavigationDisabled,
          className: pageNavigationDisabled ? disabledPaginationClassName : void 0,
          href: "#",
          isActive: index === pagination.page,
          onClick: (event) => {
            event.preventDefault();
            onPageChange?.(index);
          },
          tabIndex: pageNavigationDisabled ? -1 : void 0
        },
        pageNumber
      ));
    }
  ), /* @__PURE__ */ React.createElement(PaginationItem, null, /* @__PURE__ */ React.createElement(
    PaginationNext,
    {
      "aria-disabled": nextDisabled,
      className: nextDisabled ? disabledPaginationClassName : void 0,
      href: "#",
      onClick: (event) => {
        event.preventDefault();
        if (pagination.page < pagination.totalPages - 1) {
          onPageChange?.(pagination.page + 1);
        }
      },
      tabIndex: nextDisabled ? -1 : void 0
    }
  ))))));
}
export {
  SessionsControls
};
//# sourceMappingURL=sessions-controls.mjs.map