import * as React from 'react';

type FavoriteButtonProps = {
    isFavorite: boolean;
    isPending?: boolean;
    size?: "sm" | "default";
    onToggle?: (nextIsFavorite: boolean) => void;
    addLabel?: string;
    removeLabel?: string;
};
declare function FavoriteButton({ isFavorite, isPending, size, onToggle, addLabel, removeLabel, }: FavoriteButtonProps): React.JSX.Element;

export { FavoriteButton };
