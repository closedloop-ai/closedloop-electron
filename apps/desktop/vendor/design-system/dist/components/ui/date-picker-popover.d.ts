import * as React from 'react';

interface DatePickerPopoverProps {
    /** Currently selected date */
    value?: Date | null;
    /** Callback when date is selected */
    onSelect: (date: Date | null) => void;
    /** Placeholder text when no date is selected */
    placeholder?: string;
    /** Whether to show the trigger as just an icon (for inline use) */
    iconOnly?: boolean;
    /** Trigger element (optional, defaults to calendar icon button) */
    trigger?: React.ReactNode;
    /** Disable the popover */
    disabled?: boolean;
    /** Additional class name for trigger */
    className?: string;
    /** Date format string (default: "MMM d, yyyy") */
    dateFormat?: string;
    /** Disable dates before this date */
    fromDate?: Date;
    /** Disable dates after this date */
    toDate?: Date;
}
/**
 * DatePickerPopover provides a calendar dropdown for selecting a date
 * Can be used inline in tables with icon-only mode
 */
declare function DatePickerPopover({ value, onSelect, placeholder, iconOnly, trigger, disabled, className, dateFormat, fromDate, toDate, }: DatePickerPopoverProps): React.JSX.Element;

export { DatePickerPopover, type DatePickerPopoverProps };
