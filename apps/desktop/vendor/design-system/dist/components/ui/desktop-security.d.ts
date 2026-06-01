import * as React from 'react';
import { ComputeTarget } from '@repo/api/src/types/compute-target';

type TargetSecurity = NonNullable<ComputeTarget["security"]>;
type DesktopSecurityBadgeProps = {
    security: TargetSecurity;
};
type DesktopUpdateDownloadButtonProps = {
    downloadUrl: string | null;
    isLoading: boolean;
};
declare function getTargetSecurity(target: {
    security?: TargetSecurity;
} | undefined): TargetSecurity;
declare function getSecurityLabel(security: TargetSecurity): string;
declare function requiresDesktopUpdateAction(security: TargetSecurity): boolean;
declare function DesktopSecurityBadge({ security, }: Readonly<DesktopSecurityBadgeProps>): React.JSX.Element;
declare function DesktopUpdateDownloadButton({ downloadUrl, isLoading, }: Readonly<DesktopUpdateDownloadButtonProps>): React.JSX.Element;

export { DesktopSecurityBadge, DesktopUpdateDownloadButton, type TargetSecurity, getSecurityLabel, getTargetSecurity, requiresDesktopUpdateAction };
