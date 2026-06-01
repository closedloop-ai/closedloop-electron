import * as React from 'react';
import { SessionEventGroup } from '../types.mjs';
import 'lucide-react';

type EventGroupRowProps = {
    group: SessionEventGroup;
    defaultExpanded?: boolean;
};
declare function EventGroupRow({ group, defaultExpanded, }: EventGroupRowProps): React.JSX.Element;

export { EventGroupRow };
