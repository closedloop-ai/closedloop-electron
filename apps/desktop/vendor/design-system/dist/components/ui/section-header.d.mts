import * as React from 'react';
import { ReactNode } from 'react';

type SectionHeaderProps = {
    title: string;
    children?: ReactNode;
    isOpen?: boolean;
    onToggle?: () => void;
};
declare function SectionHeader({ title, children, isOpen, onToggle, }: Readonly<SectionHeaderProps>): React.JSX.Element;

export { SectionHeader };
