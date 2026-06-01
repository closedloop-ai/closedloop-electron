import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/avatar.tsx
import * as React from "react";
import { Avatar as AvatarPrimitive } from "radix-ui";
function Avatar({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    AvatarPrimitive.Root,
    {
      "data-slot": "avatar",
      className: cn(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        className
      ),
      ...props
    }
  );
}
function AvatarImage({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    AvatarPrimitive.Image,
    {
      "data-slot": "avatar-image",
      className: cn("aspect-square size-full", className),
      ...props
    }
  );
}
function AvatarFallback({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    AvatarPrimitive.Fallback,
    {
      "data-slot": "avatar-fallback",
      className: cn(
        "bg-muted flex size-full items-center justify-center rounded-full",
        className
      ),
      ...props
    }
  );
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback
};
//# sourceMappingURL=chunk-ZI7L5RNU.mjs.map