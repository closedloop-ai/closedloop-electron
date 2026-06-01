import * as React from 'react';
import { ReactNode } from 'react';

type SettingsActionPanelProps = {
    title: string;
    description: ReactNode;
    icon?: ReactNode;
    action?: ReactNode;
    className?: string;
};
declare function SettingsActionPanel({ title, description, icon, action, className, }: Readonly<SettingsActionPanelProps>): React.JSX.Element;

export { SettingsActionPanel };
