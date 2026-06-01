import React from "react";
"use client";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarNavLinkItem,
  SidebarSectionHeader
} from "../../chunk-JD2ZA6DU.mjs";
import "../../chunk-ZYUY3Y5N.mjs";
import "../../chunk-B7SMJA5Y.mjs";
import "../../chunk-J7MGMQSF.mjs";
import "../../chunk-J6SXEWRG.mjs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../chunk-CI7GGEKC.mjs";
import "../../chunk-D6PSM7AT.mjs";
import "../../chunk-TT7DUYOP.mjs";
import "../../chunk-MRSDI6D5.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-YM5RVC3J.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/sidebar-favorites-group.tsx
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
function SidebarFavoritesGroup({
  items,
  title = "Favorites",
  defaultOpen = true
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) {
    return null;
  }
  return /* @__PURE__ */ React.createElement(SidebarGroup, null, /* @__PURE__ */ React.createElement(Collapsible, { onOpenChange: setOpen, open }, /* @__PURE__ */ React.createElement(CollapsibleTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(
    SidebarSectionHeader,
    {
      action: /* @__PURE__ */ React.createElement(
        ChevronRightIcon,
        {
          className: `h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`
        }
      ),
      title
    }
  )), /* @__PURE__ */ React.createElement(CollapsibleContent, null, /* @__PURE__ */ React.createElement(SidebarMenu, null, items.map((item) => /* @__PURE__ */ React.createElement(
    SidebarNavLinkItem,
    {
      href: item.href,
      icon: item.icon,
      isActive: item.isActive,
      key: item.id,
      title: item.label
    }
  ))))));
}
export {
  SidebarFavoritesGroup
};
//# sourceMappingURL=sidebar-favorites-group.mjs.map