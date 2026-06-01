var React = require("react");
"use strict";
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

// components/ui/navigation-menu.tsx
var navigation_menu_exports = {};
__export(navigation_menu_exports, {
  NavigationMenu: () => NavigationMenu,
  NavigationMenuContent: () => NavigationMenuContent,
  NavigationMenuIndicator: () => NavigationMenuIndicator,
  NavigationMenuItem: () => NavigationMenuItem,
  NavigationMenuLink: () => NavigationMenuLink,
  NavigationMenuList: () => NavigationMenuList,
  NavigationMenuTrigger: () => NavigationMenuTrigger,
  NavigationMenuViewport: () => NavigationMenuViewport,
  navigationMenuTriggerStyle: () => navigationMenuTriggerStyle
});
module.exports = __toCommonJS(navigation_menu_exports);
var React = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");
var import_lucide_react = require("lucide-react");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/navigation-menu.tsx
function NavigationMenu({
  className,
  children,
  viewport = true,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    import_radix_ui.NavigationMenu.Root,
    {
      "data-slot": "navigation-menu",
      "data-viewport": viewport,
      className: cn(
        "group/navigation-menu relative flex max-w-max flex-1 items-center justify-center",
        className
      ),
      ...props
    },
    children,
    viewport && /* @__PURE__ */ React.createElement(NavigationMenuViewport, null)
  );
}
function NavigationMenuList({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    import_radix_ui.NavigationMenu.List,
    {
      "data-slot": "navigation-menu-list",
      className: cn(
        "group flex flex-1 list-none items-center justify-center gap-1",
        className
      ),
      ...props
    }
  );
}
function NavigationMenuItem({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    import_radix_ui.NavigationMenu.Item,
    {
      "data-slot": "navigation-menu-item",
      className: cn("relative", className),
      ...props
    }
  );
}
var navigationMenuTriggerStyle = (0, import_class_variance_authority.cva)(
  "group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=open]:hover:bg-accent data-[state=open]:text-accent-foreground data-[state=open]:focus:bg-accent data-[state=open]:bg-accent/50 focus-visible:ring-ring/50 outline-none transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1"
);
function NavigationMenuTrigger({
  className,
  children,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    import_radix_ui.NavigationMenu.Trigger,
    {
      "data-slot": "navigation-menu-trigger",
      className: cn(navigationMenuTriggerStyle(), "group", className),
      ...props
    },
    children,
    " ",
    /* @__PURE__ */ React.createElement(
      import_lucide_react.ChevronDownIcon,
      {
        className: "relative top-[1px] ml-1 size-3 transition duration-300 group-data-[state=open]:rotate-180",
        "aria-hidden": "true"
      }
    )
  );
}
function NavigationMenuContent({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    import_radix_ui.NavigationMenu.Content,
    {
      "data-slot": "navigation-menu-content",
      className: cn(
        "data-[motion^=from-]:animate-in data-[motion^=to-]:animate-out data-[motion^=from-]:fade-in data-[motion^=to-]:fade-out data-[motion=from-end]:slide-in-from-right-52 data-[motion=from-start]:slide-in-from-left-52 data-[motion=to-end]:slide-out-to-right-52 data-[motion=to-start]:slide-out-to-left-52 top-0 left-0 w-full p-2 pr-2.5 md:absolute md:w-auto",
        "group-data-[viewport=false]/navigation-menu:bg-popover group-data-[viewport=false]/navigation-menu:text-popover-foreground group-data-[viewport=false]/navigation-menu:data-[state=open]:animate-in group-data-[viewport=false]/navigation-menu:data-[state=closed]:animate-out group-data-[viewport=false]/navigation-menu:data-[state=closed]:zoom-out-95 group-data-[viewport=false]/navigation-menu:data-[state=open]:zoom-in-95 group-data-[viewport=false]/navigation-menu:data-[state=open]:fade-in-0 group-data-[viewport=false]/navigation-menu:data-[state=closed]:fade-out-0 group-data-[viewport=false]/navigation-menu:top-full group-data-[viewport=false]/navigation-menu:mt-1.5 group-data-[viewport=false]/navigation-menu:overflow-hidden group-data-[viewport=false]/navigation-menu:rounded-md group-data-[viewport=false]/navigation-menu:border group-data-[viewport=false]/navigation-menu:shadow group-data-[viewport=false]/navigation-menu:duration-200 **:data-[slot=navigation-menu-link]:focus:ring-0 **:data-[slot=navigation-menu-link]:focus:outline-none",
        className
      ),
      ...props
    }
  );
}
function NavigationMenuViewport({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "absolute top-full left-0 isolate z-50 flex justify-center"
      )
    },
    /* @__PURE__ */ React.createElement(
      import_radix_ui.NavigationMenu.Viewport,
      {
        "data-slot": "navigation-menu-viewport",
        className: cn(
          "origin-top-center bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-90 relative mt-1.5 h-[var(--radix-navigation-menu-viewport-height)] w-full overflow-hidden rounded-md border shadow md:w-[var(--radix-navigation-menu-viewport-width)]",
          className
        ),
        ...props
      }
    )
  );
}
function NavigationMenuLink({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    import_radix_ui.NavigationMenu.Link,
    {
      "data-slot": "navigation-menu-link",
      className: cn(
        "data-[active=true]:focus:bg-accent data-[active=true]:hover:bg-accent data-[active=true]:bg-accent/50 data-[active=true]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus-visible:ring-ring/50 [&_svg:not([class*='text-'])]:text-muted-foreground flex flex-col gap-1 rounded-sm p-2 text-sm transition-all outline-none focus-visible:ring-[3px] focus-visible:outline-1 [&_svg:not([class*='size-'])]:size-4",
        className
      ),
      ...props
    }
  );
}
function NavigationMenuIndicator({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    import_radix_ui.NavigationMenu.Indicator,
    {
      "data-slot": "navigation-menu-indicator",
      className: cn(
        "data-[state=visible]:animate-in data-[state=hidden]:animate-out data-[state=hidden]:fade-out data-[state=visible]:fade-in top-full z-[1] flex h-1.5 items-end justify-center overflow-hidden",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React.createElement("div", { className: "bg-border relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm shadow-md" })
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
  navigationMenuTriggerStyle
});
//# sourceMappingURL=navigation-menu.js.map