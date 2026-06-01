import * as React from 'react';
import { ReactNode } from 'react';

type IntegrationConnectionCardProps = {
    title: string;
    description: ReactNode;
    titleIcon?: ReactNode;
    isLoading?: boolean;
    className?: string;
    banner?: ReactNode;
    statusIcon?: ReactNode;
    statusTitle?: ReactNode;
    statusDescription?: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
};
declare function IntegrationConnectionCard({ title, description, titleIcon, isLoading, className, banner, statusIcon, statusTitle, statusDescription, actions, children, }: Readonly<IntegrationConnectionCardProps>): React.JSX.Element;

export { IntegrationConnectionCard };
