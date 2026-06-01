import * as React from 'react';
import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

type WorkflowStatTileProps = {
    label: string;
    value: string | number;
    description?: string;
    eyebrow?: string;
    icon?: LucideIcon;
    meta?: ReactNode;
    className?: string;
};
declare function WorkflowStatTile({ label, value, description, eyebrow, icon: Icon, meta, className, }: WorkflowStatTileProps): React.JSX.Element;

export { WorkflowStatTile };
