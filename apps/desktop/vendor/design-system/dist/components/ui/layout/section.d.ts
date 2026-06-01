import * as React from 'react';
import { ReactNode } from 'react';

type SectionProps = {
    title: string;
    description?: string;
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
    contentClassName?: string;
};
declare function Section({ title, description, actions, children, className, contentClassName, }: SectionProps): React.JSX.Element;

export { Section };
