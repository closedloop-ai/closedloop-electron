import * as React from 'react';
import { WorkflowEffectivenessItem, WorkflowData } from '../types.js';
import 'lucide-react';

declare function AgentPipelineGraph({ data, edges, }: {
    data: WorkflowEffectivenessItem[];
    edges: WorkflowData["cooccurrence"];
}): React.JSX.Element;

export { AgentPipelineGraph };
