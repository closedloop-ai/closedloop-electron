import * as React from 'react';
import { AgentStatus, Harness, SessionStatus, Tone } from '../types.mjs';
import 'lucide-react';

type ToneBadgeProps = {
    label: string;
    tone?: Tone;
    pulse?: boolean;
    className?: string;
};
declare function ToneBadge({ label, tone, pulse, className, }: ToneBadgeProps): React.JSX.Element;
declare function SessionStatusBadge({ status, }: {
    status: SessionStatus | string;
}): React.JSX.Element;
declare function AgentStatusBadge({ status, }: {
    status: AgentStatus | string;
}): React.JSX.Element;
declare function HarnessBadge({ harness, }: {
    harness?: Harness | null;
}): React.JSX.Element;

export { AgentStatusBadge, HarnessBadge, SessionStatusBadge, ToneBadge };
