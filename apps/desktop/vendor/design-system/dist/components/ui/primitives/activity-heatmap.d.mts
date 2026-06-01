import * as React from 'react';
import { AnalyticsHeatmapWeek } from '../types.mjs';
import 'lucide-react';

type ActivityHeatmapProps = {
    weeks: AnalyticsHeatmapWeek[];
    className?: string;
};
declare function ActivityHeatmap({ weeks, className, }: ActivityHeatmapProps): React.JSX.Element;

export { ActivityHeatmap };
