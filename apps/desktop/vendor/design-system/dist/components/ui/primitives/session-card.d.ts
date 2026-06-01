import * as React from 'react';
import { SessionRow } from '../types.js';
import 'lucide-react';

type SessionCardProps = {
    session: SessionRow;
    active?: boolean;
    className?: string;
    onClick?: () => void;
};
declare function SessionCard({ session, active, className, onClick, }: SessionCardProps): React.JSX.Element;

export { SessionCard };
