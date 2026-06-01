import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "./chunk-547UMAL4.mjs";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "./chunk-ST5QOYCX.mjs";
import {
  Avatar,
  AvatarFallback,
  AvatarImage
} from "./chunk-ZI7L5RNU.mjs";
import {
  Button
} from "./chunk-TT7DUYOP.mjs";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/user-select-popover.tsx
import * as React from "react";
import { UserPlusIcon } from "lucide-react";
function getInitials(name) {
  return name.split(" ").filter((part) => part.length > 0).map((part) => part[0]).join("").toUpperCase().slice(0, 2);
}
function UserSelectPopover({
  value,
  onSelect,
  users,
  placeholder = "Select user...",
  iconOnly = false,
  trigger,
  disabled = false,
  className
}) {
  const [open, setOpen] = React.useState(false);
  const handleSelect = (user) => {
    onSelect(user);
    setOpen(false);
  };
  const handleClear = () => {
    onSelect(null);
    setOpen(false);
  };
  const defaultTrigger = iconOnly ? /* @__PURE__ */ React.createElement(
    Button,
    {
      variant: "ghost",
      size: "icon",
      className: cn("h-8 w-8 text-muted-foreground hover:text-foreground", className),
      disabled
    },
    /* @__PURE__ */ React.createElement(UserPlusIcon, { className: "h-4 w-4" }),
    /* @__PURE__ */ React.createElement("span", { className: "sr-only" }, placeholder)
  ) : /* @__PURE__ */ React.createElement(
    Button,
    {
      variant: "outline",
      role: "combobox",
      "aria-expanded": open,
      className: cn("w-[200px] justify-start", className),
      disabled
    },
    value ? /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement(Avatar, { className: "h-5 w-5" }, value.avatarUrl && /* @__PURE__ */ React.createElement(AvatarImage, { src: value.avatarUrl, alt: value.name }), /* @__PURE__ */ React.createElement(AvatarFallback, { className: "text-[10px]" }, value.initials || getInitials(value.name))), /* @__PURE__ */ React.createElement("span", { className: "truncate" }, value.name)) : /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground" }, placeholder)
  );
  return /* @__PURE__ */ React.createElement(Popover, { open, onOpenChange: setOpen }, /* @__PURE__ */ React.createElement(PopoverTrigger, { asChild: true }, trigger || defaultTrigger), /* @__PURE__ */ React.createElement(PopoverContent, { className: "w-[250px] p-0", align: "start" }, /* @__PURE__ */ React.createElement(Command, null, /* @__PURE__ */ React.createElement(CommandInput, { placeholder: "Search users..." }), /* @__PURE__ */ React.createElement(CommandList, null, /* @__PURE__ */ React.createElement(CommandEmpty, null, "No users found."), /* @__PURE__ */ React.createElement(CommandGroup, null, value && /* @__PURE__ */ React.createElement(
    CommandItem,
    {
      onSelect: handleClear,
      className: "cursor-pointer text-muted-foreground hover:bg-muted hover:text-foreground"
    },
    "Clear selection"
  ), users.map((user) => /* @__PURE__ */ React.createElement(
    CommandItem,
    {
      key: user.id,
      value: `${user.name} ${user.email || ""}`,
      onSelect: () => handleSelect(user),
      className: "cursor-pointer hover:bg-muted"
    },
    /* @__PURE__ */ React.createElement(Avatar, { className: "mr-2 h-6 w-6" }, user.avatarUrl && /* @__PURE__ */ React.createElement(AvatarImage, { src: user.avatarUrl, alt: user.name }), /* @__PURE__ */ React.createElement(AvatarFallback, { className: "text-[10px]" }, user.initials || getInitials(user.name))),
    /* @__PURE__ */ React.createElement("div", { className: "flex flex-col" }, /* @__PURE__ */ React.createElement("span", null, user.name), user.email && /* @__PURE__ */ React.createElement("span", { className: "text-xs text-muted-foreground" }, user.email))
  )))))));
}

export {
  getInitials,
  UserSelectPopover
};
//# sourceMappingURL=chunk-HGLBRIF4.mjs.map