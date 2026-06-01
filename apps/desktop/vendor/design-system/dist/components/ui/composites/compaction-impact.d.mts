import * as React from 'react';
import { WorkflowCompactionImpactData } from '../types.mjs';
import 'lucide-react';

declare function CompactionImpact({ data, }: {
    data: WorkflowCompactionImpactData;
}): React.JSX.Element;

export { CompactionImpact };
