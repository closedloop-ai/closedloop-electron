import * as React from 'react';
import { ReactNode } from 'react';

type ComputePreferenceOption = {
    value: string;
    label: string;
    description: string;
    icon?: ReactNode;
};
type ComputePreferenceCardProps = {
    title: string;
    description: string;
    headerIcon?: ReactNode;
    isLoading?: boolean;
    disabled?: boolean;
    value?: string;
    onValueChange?: (value: string) => void;
    options: ComputePreferenceOption[];
};
declare function ComputePreferenceCard({ title, description, headerIcon, isLoading, disabled, value, onValueChange, options, }: Readonly<ComputePreferenceCardProps>): React.JSX.Element;

export { ComputePreferenceCard, type ComputePreferenceOption };
