import * as React from 'react';

type ThinkingBlockProps = {
    text: string;
    defaultExpanded?: boolean;
};
declare function ThinkingBlock({ text, defaultExpanded, }: ThinkingBlockProps): React.JSX.Element | null;

export { ThinkingBlock };
