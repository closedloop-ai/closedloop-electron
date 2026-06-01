import * as React from 'react';
import { ReactNode } from 'react';

type CollapsibleSectionProps = {
    title: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
    contentClassName?: string;
};
declare function CollapsibleSection({ title, open, onOpenChange, children, contentClassName, }: Readonly<CollapsibleSectionProps>): React.JSX.Element;

export { CollapsibleSection };
