import * as React from 'react';
import { SessionAgent } from '../types.js';
import 'lucide-react';

type AgentCardProps = {
    agent: SessionAgent;
    active?: boolean;
    className?: string;
};
declare function AgentCard({ agent, active, className, }: AgentCardProps): React.JSX.Element;

export { AgentCard };
