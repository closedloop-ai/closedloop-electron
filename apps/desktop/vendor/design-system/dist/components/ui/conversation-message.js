var React = require("react");
"use strict";
"use client";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// components/ui/conversation-message.tsx
var conversation_message_exports = {};
__export(conversation_message_exports, {
  ConversationMessage: () => ConversationMessage
});
module.exports = __toCommonJS(conversation_message_exports);

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/conversation-message.tsx
var import_lucide_react = require("lucide-react");
function ConversationMessage({
  role,
  content,
  className
}) {
  const isUser = role === "user";
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "flex gap-2",
        isUser ? "flex-row-reverse" : "flex-row",
        className
      )
    },
    /* @__PURE__ */ React.createElement(
      "span",
      {
        "aria-hidden": true,
        className: cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground",
          isUser ? "bg-primary/10 text-primary" : "bg-muted"
        )
      },
      isUser ? /* @__PURE__ */ React.createElement(import_lucide_react.UserIcon, { className: "size-3.5" }) : /* @__PURE__ */ React.createElement(import_lucide_react.BotIcon, { className: "size-3.5" })
    ),
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        )
      },
      /* @__PURE__ */ React.createElement("p", { className: "whitespace-pre-wrap break-words" }, content)
    )
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ConversationMessage
});
//# sourceMappingURL=conversation-message.js.map