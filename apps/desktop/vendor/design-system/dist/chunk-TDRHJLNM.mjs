import React from "react";
import {
  CodeBlock
} from "./chunk-BPFSJREZ.mjs";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/primitives/markdown-content.tsx
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
var LANGUAGE_REGEX = /language-(\w+)/;
var TRAILING_NEWLINE_REGEX = /\n$/;
function getTextContent(children) {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map((child) => getTextContent(child)).join("");
  }
  if (children && typeof children === "object" && "props" in children && children.props && typeof children.props === "object" && "children" in children.props) {
    return getTextContent(children.props.children);
  }
  return "";
}
var markdownComponents = {
  code({
    className,
    children,
    ...props
  }) {
    const match = LANGUAGE_REGEX.exec(className || "");
    const codeString = getTextContent(children).replace(
      TRAILING_NEWLINE_REGEX,
      ""
    );
    if (match) {
      return /* @__PURE__ */ React.createElement(
        SyntaxHighlighter,
        {
          className: "!my-2 !rounded-xl !bg-zinc-950 !text-xs",
          language: match[1],
          PreTag: "div",
          style: oneDark
        },
        codeString
      );
    }
    if (codeString.includes("\n")) {
      return /* @__PURE__ */ React.createElement(CodeBlock, { code: codeString, compact: false });
    }
    return /* @__PURE__ */ React.createElement(
      "code",
      {
        className: "rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground",
        ...props
      },
      children
    );
  },
  pre({ children }) {
    return /* @__PURE__ */ React.createElement(React.Fragment, null, children);
  }
};
function MarkdownContent({
  text,
  dense = false,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "prose prose-sm dark:prose-invert prose-headings:my-1.5 prose-p:my-1 max-w-none overflow-x-auto prose-headings:text-sm text-[13px]",
        dense && "prose-p:my-0.5 text-[12px]",
        className
      )
    },
    /* @__PURE__ */ React.createElement(
      ReactMarkdown,
      {
        components: markdownComponents,
        remarkPlugins: [remarkGfm]
      },
      text
    )
  );
}

export {
  MarkdownContent
};
//# sourceMappingURL=chunk-TDRHJLNM.mjs.map