import * as React from 'react';
import { ReactNode } from 'react';

type ListItemProps = {
    title: ReactNode;
    meta?: ReactNode;
    detail?: ReactNode;
    active?: boolean;
    onClick?: () => void;
    className?: string;
};
declare function ListItem({ title, meta, detail, active, onClick, className, }: ListItemProps): React.JSX.Element;

export { ListItem };
