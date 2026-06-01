import React from "react";
import {
  Textarea
} from "./chunk-64QT2WSE.mjs";
import {
  Button
} from "./chunk-TT7DUYOP.mjs";

// components/ui/comment-composer.tsx
import { useEffect, useState } from "react";
function CommentComposer({
  value,
  defaultValue = "",
  placeholder = "Add a comment...",
  submitLabel = "Comment",
  cancelLabel = "Cancel",
  disabled = false,
  isPending = false,
  minHeightClassName = "min-h-[96px]",
  containerClassName,
  footerClassName,
  leadingActions,
  helperText,
  onValueChange,
  onSubmit,
  onCancel
}) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const draft = value ?? internalValue;
  useEffect(() => {
    if (value === void 0) {
      setInternalValue(defaultValue);
    }
  }, [defaultValue, value]);
  function setDraft(nextValue) {
    if (value === void 0) {
      setInternalValue(nextValue);
    }
    onValueChange?.(nextValue);
  }
  function submit() {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || disabled || isPending) {
      return;
    }
    onSubmit(trimmed);
    if (value === void 0) {
      setInternalValue("");
      onValueChange?.("");
    }
  }
  function handleCancelClick(event) {
    event.stopPropagation();
    if (value === void 0) {
      setInternalValue(defaultValue);
      onValueChange?.(defaultValue);
    }
    onCancel?.();
  }
  function handleSubmitClick(event) {
    event.stopPropagation();
    submit();
  }
  function handleKeyDown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  }
  const hasContent = draft.trim().length > 0;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: containerClassName ?? "flex flex-col gap-2",
      "data-comment-control": "true"
    },
    helperText == null ? null : helperText,
    /* @__PURE__ */ React.createElement(
      Textarea,
      {
        className: `${minHeightClassName} resize-y text-sm`,
        "data-comment-control": "true",
        disabled: disabled || isPending,
        onChange: (event) => setDraft(event.target.value),
        onKeyDown: handleKeyDown,
        placeholder,
        value: draft
      }
    ),
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: footerClassName ?? (leadingActions == null ? "flex justify-end" : "flex items-center justify-between gap-2")
      },
      leadingActions == null ? null : /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1" }, leadingActions),
      /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-end gap-2" }, onCancel ? /* @__PURE__ */ React.createElement(
        Button,
        {
          "data-comment-control": "true",
          disabled: disabled || isPending,
          onClick: handleCancelClick,
          size: "sm",
          type: "button",
          variant: "outline"
        },
        cancelLabel
      ) : null, /* @__PURE__ */ React.createElement(
        Button,
        {
          "data-comment-control": "true",
          disabled: disabled || isPending || !hasContent,
          onClick: handleSubmitClick,
          size: "sm",
          type: "button"
        },
        submitLabel
      ))
    )
  );
}

export {
  CommentComposer
};
//# sourceMappingURL=chunk-7D373W5W.mjs.map