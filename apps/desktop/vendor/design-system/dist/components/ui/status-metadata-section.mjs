import React from "react";
"use client";
import {
  UserSelectPopover
} from "../../chunk-HGLBRIF4.mjs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../chunk-XQL5M77A.mjs";
import "../../chunk-547UMAL4.mjs";
import {
  Label
} from "../../chunk-U7KVRX5X.mjs";
import "../../chunk-ST5QOYCX.mjs";
import "../../chunk-6LPHEING.mjs";
import {
  StatusIcon
} from "../../chunk-U2HXSCXU.mjs";
import "../../chunk-TQBNQE2F.mjs";
import "../../chunk-ZI7L5RNU.mjs";
import "../../chunk-TT7DUYOP.mjs";
import {
  MetadataSection
} from "../../chunk-ZOB3YFAZ.mjs";
import "../../chunk-76IVWEZL.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/status-metadata-section.tsx
import { useId } from "react";
function StatusMetadataSection({
  status,
  assignee,
  teamMembers,
  onStatusChange,
  onAssigneeChange,
  options,
  className,
  layout = "vertical"
}) {
  const statusId = useId();
  const statusOptions = options.map((statusOption) => /* @__PURE__ */ React.createElement(SelectItem, { key: statusOption.value, value: statusOption.value }, /* @__PURE__ */ React.createElement("span", { className: "inline-flex items-center gap-1.5" }, /* @__PURE__ */ React.createElement(StatusIcon, { size: 16, status: statusOption.iconStatus }), statusOption.label)));
  const content = layout === "horizontal" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Select, { onValueChange: onStatusChange, value: status }, /* @__PURE__ */ React.createElement(
    SelectTrigger,
    {
      className: "min-w-0 justify-start gap-1 [&>:last-child]:hidden",
      size: "sm"
    },
    /* @__PURE__ */ React.createElement(SelectValue, null)
  ), /* @__PURE__ */ React.createElement(SelectContent, null, statusOptions)), /* @__PURE__ */ React.createElement(
    UserSelectPopover,
    {
      className: "h-8 w-auto min-w-[7rem] px-3",
      disabled: teamMembers.length === 0,
      onSelect: onAssigneeChange,
      placeholder: "Select assignee...",
      users: teamMembers,
      value: assignee
    }
  )) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement(Label, { htmlFor: statusId }, "Status"), /* @__PURE__ */ React.createElement(Select, { onValueChange: onStatusChange, value: status }, /* @__PURE__ */ React.createElement(
    SelectTrigger,
    {
      className: "min-w-0 justify-start bg-transparent hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent [&>:last-child]:hidden",
      id: statusId
    },
    /* @__PURE__ */ React.createElement(SelectValue, null)
  ), /* @__PURE__ */ React.createElement(SelectContent, null, statusOptions))), /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement(Label, null, "Assignee"), /* @__PURE__ */ React.createElement(
    UserSelectPopover,
    {
      className: "bg-transparent hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent",
      disabled: teamMembers.length === 0,
      onSelect: onAssigneeChange,
      placeholder: "Select assignee...",
      users: teamMembers,
      value: assignee
    }
  )));
  return /* @__PURE__ */ React.createElement(MetadataSection, { className, layout }, content);
}
export {
  StatusMetadataSection
};
//# sourceMappingURL=status-metadata-section.mjs.map