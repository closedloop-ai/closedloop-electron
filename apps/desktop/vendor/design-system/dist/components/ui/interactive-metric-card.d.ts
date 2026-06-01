import * as React from 'react';
import { ComponentProps } from 'react';
import { MetricCard } from './primitives/metric-card.js';
import './card.js';
import 'lucide-react';

type InteractiveMetricCardProps = {
    active?: boolean;
    onClick?: () => void;
} & ComponentProps<typeof MetricCard>;
declare function InteractiveMetricCard({ active, className, onClick, ...props }: Readonly<InteractiveMetricCardProps>): React.JSX.Element;

export { InteractiveMetricCard };
