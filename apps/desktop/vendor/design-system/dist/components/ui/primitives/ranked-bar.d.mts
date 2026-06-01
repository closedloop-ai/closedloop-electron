import * as React from 'react';
import { ReactNode } from 'react';

type RankedBarProps = {
    label: ReactNode;
    value: string | number;
    percent: number;
    description?: ReactNode;
    badge?: ReactNode;
    className?: string;
};
declare function RankedBar({ label, value, percent, description, badge, className, }: RankedBarProps): React.JSX.Element;

export { RankedBar };
