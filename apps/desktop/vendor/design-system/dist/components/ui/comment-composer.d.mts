import * as React from 'react';
import { ReactNode } from 'react';

type CommentComposerProps = {
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    submitLabel?: ReactNode;
    cancelLabel?: ReactNode;
    disabled?: boolean;
    isPending?: boolean;
    minHeightClassName?: string;
    containerClassName?: string;
    footerClassName?: string;
    leadingActions?: ReactNode;
    helperText?: ReactNode;
    onValueChange?: (value: string) => void;
    onSubmit: (body: string) => void;
    onCancel?: () => void;
};
declare function CommentComposer({ value, defaultValue, placeholder, submitLabel, cancelLabel, disabled, isPending, minHeightClassName, containerClassName, footerClassName, leadingActions, helperText, onValueChange, onSubmit, onCancel, }: Readonly<CommentComposerProps>): React.JSX.Element;

export { CommentComposer, type CommentComposerProps };
