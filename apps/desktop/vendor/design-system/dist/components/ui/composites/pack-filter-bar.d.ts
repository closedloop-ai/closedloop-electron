import * as React from 'react';
import { Harness } from '../types.js';
import 'lucide-react';

type PackFilterBarProps = {
    query?: string;
    harness?: string;
    harnesses: Harness[];
    onQueryChange?: (value: string) => void;
    onHarnessChange?: (value: string) => void;
    title?: string;
    description?: string;
};
declare function PackFilterBar({ query, harness, harnesses, onQueryChange, onHarnessChange, title, description, }: PackFilterBarProps): React.JSX.Element;

export { PackFilterBar };
