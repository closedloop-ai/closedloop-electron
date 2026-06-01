import React from "react";
"use client";
import {
  TabsList,
  TabsTrigger
} from "../../../chunk-76IVWEZL.mjs";
import {
  cn
} from "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/primitives/underline-tabs.tsx
function UnderlineTabsList({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    TabsList,
    {
      className: cn(
        "h-auto w-full justify-start gap-0 rounded-none border-border border-b bg-transparent p-0 px-4 pt-2",
        className
      ),
      ...props
    }
  );
}
function UnderlineTabsTrigger({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    TabsTrigger,
    {
      className: cn(
        "h-auto flex-none rounded-none border-0 border-transparent border-b-2 bg-transparent px-3 py-1.5 text-base text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-primary dark:data-[state=active]:bg-transparent",
        className
      ),
      ...props
    }
  );
}
export {
  UnderlineTabsList,
  UnderlineTabsTrigger
};
//# sourceMappingURL=underline-tabs.mjs.map