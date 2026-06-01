import * as React from 'react';
import { ReactNode, CSSProperties } from 'react';

type KanbanBoardLayoutProps = {
    children: ReactNode;
    className?: string;
    contentClassName?: string;
    style?: CSSProperties;
};
declare function KanbanBoardLayout({ children, className, contentClassName, style, }: KanbanBoardLayoutProps): React.JSX.Element;
type KanbanColumnLayoutProps = {
    header: ReactNode;
    children?: ReactNode;
    emptyState?: ReactNode;
    footer?: ReactNode;
    className?: string;
    bodyClassName?: string;
};
declare function KanbanColumnLayout({ header, children, emptyState, footer, className, bodyClassName, }: KanbanColumnLayoutProps): React.JSX.Element;
type KanbanColumnProps = {
    title: string;
    count?: number;
    icon?: ReactNode;
    trailing?: ReactNode;
    children?: ReactNode;
    emptyState?: ReactNode;
    footer?: ReactNode;
    className?: string;
    bodyClassName?: string;
    headerClassName?: string;
    highlighted?: boolean;
    highlightedBodyClassName?: string;
};
declare function KanbanColumn({ title, count, icon, trailing, children, emptyState, footer, className, bodyClassName, headerClassName, highlighted, highlightedBodyClassName, }: KanbanColumnProps): React.JSX.Element;
type KanbanColumnHeaderProps = {
    icon?: ReactNode;
    title: string;
    count?: number;
    trailing?: ReactNode;
    className?: string;
};
declare function KanbanColumnHeader({ icon, title, count, trailing, className, }: KanbanColumnHeaderProps): React.JSX.Element;
type KanbanCardFrameProps = {
    children: ReactNode;
    className?: string;
    active?: boolean;
};
declare function KanbanCardFrame({ children, className, active, }: KanbanCardFrameProps): React.JSX.Element;

export { KanbanBoardLayout, KanbanCardFrame, KanbanColumn, KanbanColumnHeader, KanbanColumnLayout };
