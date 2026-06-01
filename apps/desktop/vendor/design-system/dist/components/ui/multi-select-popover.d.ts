import * as React from 'react';

type MultiSelectOption = {
    label: string;
    value: string;
    keywords?: string[];
};
type MultiSelectPopoverProps = {
    value: string[];
    options: MultiSelectOption[];
    onChange?: (next: string[]) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    className?: string;
    contentClassName?: string;
    disabled?: boolean;
};
declare function MultiSelectPopover({ value, options, onChange, placeholder, searchPlaceholder, emptyText, className, contentClassName, disabled, }: MultiSelectPopoverProps): React.JSX.Element;

export { type MultiSelectOption, MultiSelectPopover, type MultiSelectPopoverProps };
