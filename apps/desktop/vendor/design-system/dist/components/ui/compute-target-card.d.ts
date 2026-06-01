import * as React from 'react';
import { ReactNode } from 'react';

type ComputeTargetCardProps = {
    name: string;
    isOnline: boolean;
    securityBadge?: ReactNode;
    subtitle: ReactNode;
    actions?: ReactNode;
    shareChecked: boolean;
    shareDisabled?: boolean;
    onShareCheckedChange?: (checked: boolean) => void;
    shareTitle?: string;
    shareDescription?: string;
    systemCheck?: ReactNode;
    className?: string;
};
declare function ComputeTargetCard({ name, isOnline, securityBadge, subtitle, actions, shareChecked, shareDisabled, onShareCheckedChange, shareTitle, shareDescription, systemCheck, className, }: Readonly<ComputeTargetCardProps>): React.JSX.Element;

export { ComputeTargetCard };
