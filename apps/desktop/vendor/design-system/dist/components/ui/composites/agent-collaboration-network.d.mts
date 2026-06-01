import * as React from 'react';
import { WorkflowEffectivenessItem } from '../types.mjs';
import 'lucide-react';

type AgentCollaborationNetworkProps = {
    data: WorkflowEffectivenessItem[];
    edges: Array<{
        source: string;
        target: string;
        weight: number;
    }>;
};
declare function AgentCollaborationNetwork({ data, edges, }: AgentCollaborationNetworkProps): React.JSX.Element;

export { AgentCollaborationNetwork };
