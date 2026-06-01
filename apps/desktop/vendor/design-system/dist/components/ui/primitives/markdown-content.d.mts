import * as React from 'react';

type MarkdownContentProps = {
    text: string;
    dense?: boolean;
    className?: string;
};
declare function MarkdownContent({ text, dense, className, }: MarkdownContentProps): React.JSX.Element;

export { MarkdownContent };
