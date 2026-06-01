import * as React from 'react';

type StarRatingProps = {
    value: number;
    onChange?: (value: number) => void;
    size?: "sm" | "default" | "lg";
    readonly?: boolean;
};
declare function StarRating({ value, onChange, size, readonly, }: StarRatingProps): React.JSX.Element;

export { StarRating };
