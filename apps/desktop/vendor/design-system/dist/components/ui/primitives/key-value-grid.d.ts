import * as React from 'react';
import { JsonValue } from '../types.js';
import 'lucide-react';

type KeyValueGridProps = {
    data: Record<string, JsonValue>;
    priority?: string[];
};
declare function KeyValueGrid({ data, priority, }: KeyValueGridProps): React.JSX.Element;

export { KeyValueGrid };
