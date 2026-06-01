import React from "react";
"use client";
import {
  ConversationMessage
} from "../../chunk-7VER2F6Z.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/conversation-transcript.tsx
function ConversationTranscript({
  messages,
  className
}) {
  return /* @__PURE__ */ React.createElement("div", { "aria-label": "Conversation", className, role: "log" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-4" }, messages.map((message) => /* @__PURE__ */ React.createElement(
    ConversationMessage,
    {
      content: message.content,
      key: message.id,
      role: message.role
    }
  ))));
}
export {
  ConversationTranscript
};
//# sourceMappingURL=conversation-transcript.mjs.map