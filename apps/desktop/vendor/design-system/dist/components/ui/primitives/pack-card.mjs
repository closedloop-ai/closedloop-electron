import React from "react";
import {
  Sparkline
} from "../../../chunk-3VJLNCQH.mjs";
import {
  Badge
} from "../../../chunk-3I7NW6GS.mjs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../../chunk-ZKMGHYX7.mjs";
import {
  badgeClassName
} from "../../../chunk-UGNO5UUO.mjs";
import {
  Button
} from "../../../chunk-TT7DUYOP.mjs";
import "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/primitives/pack-card.tsx
function PackCard({
  pack,
  selected = false,
  onSelect,
  onInstallPack
}) {
  return /* @__PURE__ */ React.createElement(Card, { className: selected ? "ring-1 ring-primary/40" : void 0 }, /* @__PURE__ */ React.createElement(CardHeader, { className: "space-y-2" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-start justify-between gap-3" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "space-y-1 text-left",
      disabled: !onSelect,
      onClick: () => onSelect?.(pack.id),
      type: "button"
    },
    /* @__PURE__ */ React.createElement(CardTitle, null, pack.displayName),
    /* @__PURE__ */ React.createElement(CardDescription, { className: "font-mono" }, pack.id)
  ), /* @__PURE__ */ React.createElement("div", { className: "text-right text-amber-600" }, /* @__PURE__ */ React.createElement("div", { className: "font-semibold text-lg" }, "\u2605 ", pack.stars || "\u2014"), /* @__PURE__ */ React.createElement(
    Sparkline,
    {
      className: "mt-1 ml-auto",
      values: (pack.history || []).map((point) => point.stars)
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-1.5" }, pack.category ? /* @__PURE__ */ React.createElement(Badge, { className: badgeClassName, variant: "muted" }, pack.category) : null, pack.installedHarnesses.length > 0 ? /* @__PURE__ */ React.createElement(Badge, { className: badgeClassName, variant: "success" }, "Installed (", pack.installedHarnesses.join(", "), ")") : /* @__PURE__ */ React.createElement(Badge, { className: badgeClassName, variant: "muted" }, "Not installed"), pack.usageCount ? /* @__PURE__ */ React.createElement(Badge, { className: badgeClassName, variant: "muted" }, pack.usageCount, " uses") : null)), /* @__PURE__ */ React.createElement(CardContent, { className: "space-y-3" }, pack.description ? /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, pack.description) : null, pack.placeholderReason ? /* @__PURE__ */ React.createElement("p", { className: "text-amber-700 text-xs italic" }, pack.placeholderReason) : null, pack.installNotes ? /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-xs" }, pack.installNotes) : null, pack.usage ? /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-xs" }, "Used ", pack.usage.toolCalls, " times across ", pack.usage.sessions, " ", "sessions.") : null, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-2" }, /* @__PURE__ */ React.createElement(
    Button,
    {
      disabled: !onSelect,
      onClick: () => onSelect?.(pack.id),
      size: "sm",
      variant: "secondary"
    },
    "View details"
  ), pack.harnesses.map((harness) => /* @__PURE__ */ React.createElement(
    Button,
    {
      disabled: !onInstallPack,
      key: harness,
      onClick: () => onInstallPack?.(pack.id, harness),
      size: "sm",
      variant: "outline"
    },
    pack.installedHarnesses.includes(harness) ? "Uninstall" : "Install",
    " ",
    harness
  )))));
}
export {
  PackCard
};
//# sourceMappingURL=pack-card.mjs.map