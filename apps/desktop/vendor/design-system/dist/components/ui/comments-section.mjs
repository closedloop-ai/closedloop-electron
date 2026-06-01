import React from "react";
"use client";
import {
  CommentAvatar
} from "../../chunk-72GRQU3Q.mjs";
import {
  CommentComposer
} from "../../chunk-7D373W5W.mjs";
import "../../chunk-64QT2WSE.mjs";
import {
  CommentThreadCard,
  CommentThreadHeader,
  CommentThreadMain,
  CommentThreadReplies,
  CommentThreadReplyRow
} from "../../chunk-DVNSQRIQ.mjs";
import {
  EmptyState
} from "../../chunk-5O7DGJTJ.mjs";
import {
  CollapsibleSection
} from "../../chunk-VMGHNFYV.mjs";
import "../../chunk-DPPRFUOX.mjs";
import "../../chunk-ZI7L5RNU.mjs";
import {
  formatDateTime,
  formatRelativeLabel
} from "../../chunk-UGNO5UUO.mjs";
import "../../chunk-TT7DUYOP.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/comments-section.tsx
import { MessageSquare } from "lucide-react";
import { useState } from "react";
function CommentsSection({
  documentId: _documentId,
  defaultOpen = false,
  comments = [],
  draft,
  disabled = false,
  isSubmitting = false,
  onDraftChange,
  onSubmitComment,
  onReply
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [replyingToId, setReplyingToId] = useState(null);
  const hasComments = comments.length > 0;
  return /* @__PURE__ */ React.createElement(CollapsibleSection, { onOpenChange: setIsOpen, open: isOpen, title: "Comments" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, hasComments ? /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, comments.map((comment) => /* @__PURE__ */ React.createElement(
    CommentThreadItemCard,
    {
      comment,
      isReplyOpen: replyingToId === comment.id,
      key: comment.id,
      onCloseReply: () => setReplyingToId(null),
      onOpenReply: () => setReplyingToId(comment.id),
      onReply
    }
  ))) : /* @__PURE__ */ React.createElement(
    EmptyState,
    {
      className: "border-dashed",
      description: "Start a discussion, capture feedback, or ask for clarification on this artifact.",
      icon: MessageSquare,
      title: "No comments yet"
    }
  ), /* @__PURE__ */ React.createElement(
    CommentComposer,
    {
      defaultValue: draft,
      disabled,
      isPending: isSubmitting,
      onSubmit: (body) => {
        onSubmitComment?.(body);
      },
      onValueChange: onDraftChange,
      placeholder: "Add a comment...",
      submitLabel: "Comment"
    }
  )));
}
function CommentThreadItemCard({
  comment,
  isReplyOpen,
  onOpenReply,
  onCloseReply,
  onReply
}) {
  return /* @__PURE__ */ React.createElement(CommentThreadCard, null, /* @__PURE__ */ React.createElement(
    CommentThreadMain,
    {
      avatar: /* @__PURE__ */ React.createElement(
        CommentAvatar,
        {
          author: comment.author.name,
          authorAvatar: comment.author.avatarUrl,
          authorKind: comment.author.kind,
          size: "sm"
        }
      ),
      content: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
        CommentThreadHeader,
        {
          author: /* @__PURE__ */ React.createElement("span", { className: "font-medium text-sm" }, comment.author.name),
          metadata: /* @__PURE__ */ React.createElement(
            "span",
            {
              className: "text-muted-foreground text-xs",
              title: formatDateTime(comment.createdAt)
            },
            formatRelativeLabel(comment.createdAt)
          )
        }
      ), /* @__PURE__ */ React.createElement("p", { className: "whitespace-pre-wrap text-sm" }, comment.body))
    }
  ), comment.replies?.length ? /* @__PURE__ */ React.createElement(CommentThreadReplies, { className: "border-l border-l-border bg-transparent pl-5", showDivider: false }, comment.replies.map((reply) => /* @__PURE__ */ React.createElement(
    CommentThreadReplyRow,
    {
      avatar: /* @__PURE__ */ React.createElement(
        CommentAvatar,
        {
          author: reply.author.name,
          authorAvatar: reply.author.avatarUrl,
          authorKind: reply.author.kind,
          size: "xs"
        }
      ),
      body: /* @__PURE__ */ React.createElement("p", { className: "whitespace-pre-wrap text-sm" }, reply.body),
      header: /* @__PURE__ */ React.createElement(
        CommentThreadHeader,
        {
          author: /* @__PURE__ */ React.createElement("span", { className: "font-medium text-sm" }, reply.author.name),
          metadata: /* @__PURE__ */ React.createElement(
            "span",
            {
              className: "text-muted-foreground text-xs",
              title: formatDateTime(reply.createdAt)
            },
            formatRelativeLabel(reply.createdAt)
          )
        }
      ),
      key: reply.id
    }
  ))) : null, onReply ? /* @__PURE__ */ React.createElement("div", { className: "flex justify-end" }, isReplyOpen ? /* @__PURE__ */ React.createElement("div", { className: "w-full" }, /* @__PURE__ */ React.createElement(
    CommentComposer,
    {
      minHeightClassName: "min-h-[72px]",
      onCancel: onCloseReply,
      onSubmit: (body) => {
        onReply(comment.id, body);
        onCloseReply();
      },
      placeholder: "Reply...",
      submitLabel: "Reply"
    }
  )) : /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "font-medium text-primary text-sm hover:underline",
      onClick: onOpenReply,
      type: "button"
    },
    "Reply"
  )) : null);
}
export {
  CommentsSection
};
//# sourceMappingURL=comments-section.mjs.map