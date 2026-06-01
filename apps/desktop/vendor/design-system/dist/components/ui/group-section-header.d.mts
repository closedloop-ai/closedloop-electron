import * as React from 'react';
import { ReactNode } from 'react';

type GroupSectionHeaderProps = Readonly<{
    icon: ReactNode;
    label: string;
    count: number;
    isOpen: boolean;
    onToggle: () => void;
    className?: string;
}>;
declare function GroupSectionHeader({ icon, label, count, isOpen, onToggle, className, }: GroupSectionHeaderProps): React.JSX.Element;

export { GroupSectionHeader };
