import * as React from 'react';
import { ReactNode, ComponentProps } from 'react';
import { Card } from '../card.js';
import { LucideIcon } from 'lucide-react';

type MetricCardProps = {
    label: string;
    value: string | number;
    detail?: ReactNode;
    trend?: ReactNode;
    icon?: LucideIcon;
    className?: string;
} & ComponentProps<typeof Card>;
declare function MetricCard({ label, value, detail, trend, icon: Icon, className, ...props }: MetricCardProps): React.JSX.Element;

export { MetricCard };
