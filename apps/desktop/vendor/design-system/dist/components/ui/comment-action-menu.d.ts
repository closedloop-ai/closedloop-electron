import * as React from 'react';

type CommentActionMenuProps = {
    canEdit?: boolean;
    canDelete?: boolean;
    isResolvePending?: boolean;
    onEditToggle: () => void;
    onDelete: () => void;
    onChatAboutThis?: () => void;
    onResolveAction?: () => void;
    resolveLabel?: string;
    copyValue?: string | null;
    copySuccessMessage?: string;
    chatLabel?: string;
};
declare function CommentActionMenu({ canEdit, canDelete, isResolvePending, onEditToggle, onDelete, onChatAboutThis, onResolveAction, resolveLabel, copyValue, copySuccessMessage, chatLabel, }: Readonly<CommentActionMenuProps>): React.JSX.Element;

export { CommentActionMenu, type CommentActionMenuProps };
