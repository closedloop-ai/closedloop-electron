import * as React from 'react';
import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

type EmptyStateProps = {
    icon: LucideIcon;
    title: string;
    description?: string;
    className?: string;
    action?: ReactNode;
};
declare function EmptyState({ icon: Icon, title, description, className, action, }: Readonly<EmptyStateProps>): React.JSX.Element;

export { EmptyState };
