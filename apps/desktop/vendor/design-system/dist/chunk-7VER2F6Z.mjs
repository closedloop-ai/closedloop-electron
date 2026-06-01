import React from "react";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/conversation-message.tsx
import { BotIcon, UserIcon } from "lucide-react";
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
      isUser ? /* @__PURE__ */ React.createElement(UserIcon, { className: "size-3.5" }) : /* @__PURE__ */ React.createElement(BotIcon, { className: "size-3.5" })
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

export {
  ConversationMessage
};
//# sourceMappingURL=chunk-7VER2F6Z.mjs.map