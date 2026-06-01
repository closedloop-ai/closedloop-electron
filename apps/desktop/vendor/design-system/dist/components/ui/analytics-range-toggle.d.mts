import * as React from 'react';

type AnalyticsRangeToggleOption = {
    label: string;
    value: string;
};
type AnalyticsRangeToggleProps = {
    label?: string;
    options: AnalyticsRangeToggleOption[];
    value: string;
    onValueChange?: (value: string) => void;
    className?: string;
};
declare function AnalyticsRangeToggle({ label, options, value, onValueChange, className, }: Readonly<AnalyticsRangeToggleProps>): React.JSX.Element;

export { AnalyticsRangeToggle, type AnalyticsRangeToggleOption };
