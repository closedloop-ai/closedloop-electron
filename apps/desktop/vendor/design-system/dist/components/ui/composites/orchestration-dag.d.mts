import * as React from 'react';
import { WorkflowOrchestrationData } from '../types.mjs';
import 'lucide-react';

declare function OrchestrationDag({ data, }: {
    data: WorkflowOrchestrationData;
}): React.JSX.Element;

export { OrchestrationDag };
