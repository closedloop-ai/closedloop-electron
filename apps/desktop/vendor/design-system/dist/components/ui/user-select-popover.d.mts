import * as React from 'react';

interface User {
    id: string;
    name: string;
    email?: string;
    avatarUrl?: string;
    initials?: string;
}
interface UserSelectPopoverProps {
    /** Currently selected user */
    value?: User | null;
    /** Callback when user is selected */
    onSelect: (user: User | null) => void;
    /** List of users to choose from */
    users: User[];
    /** Placeholder text when no user is selected */
    placeholder?: string;
    /** Whether to show the trigger as just an icon (for inline use) */
    iconOnly?: boolean;
    /** Trigger element (optional, defaults to add-person icon button) */
    trigger?: React.ReactNode;
    /** Disable the popover */
    disabled?: boolean;
    /** Additional class name for trigger */
    className?: string;
}
/**
 * Get initials from a name
 */
declare function getInitials(name: string): string;
/**
 * UserSelectPopover provides a searchable dropdown for selecting a user
 * Can be used inline in tables with icon-only mode
 */
declare function UserSelectPopover({ value, onSelect, users, placeholder, iconOnly, trigger, disabled, className, }: UserSelectPopoverProps): React.JSX.Element;

export { type User, UserSelectPopover, type UserSelectPopoverProps, getInitials };
