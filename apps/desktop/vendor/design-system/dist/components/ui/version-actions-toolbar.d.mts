import * as React from 'react';

type VersionActionsToolbarProps = {
    canRestoreVersion?: boolean;
    onRestoreVersion: () => void;
    isRestoring?: boolean;
    canSaveVersion?: boolean;
    hasUnsavedChanges?: boolean;
    onSaveVersion: () => void;
    isSaving?: boolean;
    onToggleComments: (pressed: boolean) => void;
    openThreadCount: number;
    showComments: boolean;
    showCommentToggle?: boolean;
};
declare function VersionActionsToolbar({ canRestoreVersion, onRestoreVersion, isRestoring, canSaveVersion, hasUnsavedChanges, onSaveVersion, isSaving, onToggleComments, openThreadCount, showComments, showCommentToggle, }: Readonly<VersionActionsToolbarProps>): React.JSX.Element;

export { VersionActionsToolbar };
