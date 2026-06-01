import * as React from 'react';

declare const THEMES: {
    readonly light: "";
    readonly dark: ".dark";
};
type ChartConfig = {
    [k in string]: {
        label?: React.ReactNode;
        icon?: React.ComponentType;
    } & ({
        color?: string;
        theme?: never;
    } | {
        color?: never;
        theme: Record<keyof typeof THEMES, string>;
    });
};
declare function ChartContainer({ id, className, children, config, ...props }: React.ComponentProps<"div"> & {
    config: ChartConfig;
    children: React.ReactElement;
}): React.JSX.Element;
declare const ChartStyle: ({ id, config }: {
    id: string;
    config: ChartConfig;
}) => React.JSX.Element | null;
declare const ChartTooltip: React.FC<any>;
declare function ChartTooltipContent({ active, payload, className, indicator, hideLabel, hideIndicator, label, labelFormatter, labelClassName, formatter, color, nameKey, labelKey, }: // biome-ignore lint/suspicious/noExplicitAny: recharts types incompatible with React 19 JSX
any & {
    hideLabel?: boolean;
    hideIndicator?: boolean;
    indicator?: "line" | "dot" | "dashed";
    nameKey?: string;
    labelKey?: string;
}): React.JSX.Element | null;
declare const ChartLegend: React.FC<any>;
declare function ChartLegendContent({ className, hideIcon, payload, verticalAlign, nameKey, }: React.ComponentProps<"div"> & {
    payload?: any[];
    verticalAlign?: "top" | "bottom";
    hideIcon?: boolean;
    nameKey?: string;
}): React.JSX.Element | null;

export { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartStyle, ChartTooltip, ChartTooltipContent };
