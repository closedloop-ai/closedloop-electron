import * as React$1 from 'react';

type FilterChipProps = {
    label: string;
    onRemove: () => void;
    children?: React.ReactNode;
    dropdownClassName?: string;
    className?: string;
};
declare function FilterChip({ label, onRemove, children, dropdownClassName, className, }: FilterChipProps): React$1.JSX.Element;

export { FilterChip };
