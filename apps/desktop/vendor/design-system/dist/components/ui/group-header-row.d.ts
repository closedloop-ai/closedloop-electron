import * as React from 'react';

type GroupHeaderRowProps = Readonly<{
    title: string;
    count: number;
    isOpen: boolean;
    onToggle: () => void;
    className?: string;
}>;
declare function GroupHeaderRow({ title, count, isOpen, onToggle, className, }: GroupHeaderRowProps): React.JSX.Element;

export { GroupHeaderRow };
