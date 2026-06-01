import * as React from 'react';

type CodeBlockProps = {
    code?: string;
    children?: string;
    className?: string;
    filename?: string;
    compact?: boolean;
    label?: string;
    tone?: "default" | "danger" | "success";
    maxHeight?: string | null;
    showLineNumbers?: boolean;
};
declare function CodeBlock({ code, children, className, filename, compact, label, tone, maxHeight, showLineNumbers, }: CodeBlockProps): React.JSX.Element;

export { CodeBlock };
