import * as React from 'react';
import { ReactNode } from 'react';

type SidebarFavoriteItem = {
    id: string;
    href: string;
    label: string;
    icon?: ReactNode;
    isActive?: boolean;
};
declare function SidebarFavoritesGroup({ items, title, defaultOpen, }: Readonly<{
    items: SidebarFavoriteItem[];
    title?: string;
    defaultOpen?: boolean;
}>): React.JSX.Element | null;

export { type SidebarFavoriteItem, SidebarFavoritesGroup };
