import React from "react";
// components/ui/sonner.tsx
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";
var Toaster = ({ ...props }) => {
  const { theme = "system" } = useTheme();
  return /* @__PURE__ */ React.createElement(
    Sonner,
    {
      theme,
      className: "toaster group",
      icons: {
        success: /* @__PURE__ */ React.createElement(CircleCheckIcon, { className: "size-4" }),
        info: /* @__PURE__ */ React.createElement(InfoIcon, { className: "size-4" }),
        warning: /* @__PURE__ */ React.createElement(TriangleAlertIcon, { className: "size-4" }),
        error: /* @__PURE__ */ React.createElement(OctagonXIcon, { className: "size-4" }),
        loading: /* @__PURE__ */ React.createElement(Loader2Icon, { className: "size-4 animate-spin" })
      },
      style: {
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "var(--radius)"
      },
      ...props
    }
  );
};

export {
  toast,
  Toaster
};
//# sourceMappingURL=chunk-VGUI7V4Z.mjs.map