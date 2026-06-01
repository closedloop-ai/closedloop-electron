import * as React from 'react';

type IntegrationDisconnectDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => Promise<void> | void;
    title: string;
    description: string;
    confirmLabel?: string;
    pendingLabel?: string;
    isPending?: boolean;
};
declare function IntegrationDisconnectDialog({ open, onOpenChange, onConfirm, title, description, confirmLabel, pendingLabel, isPending, }: Readonly<IntegrationDisconnectDialogProps>): React.JSX.Element;

export { IntegrationDisconnectDialog };
