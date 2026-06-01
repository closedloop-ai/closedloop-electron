import * as React from 'react';
import { SessionControls, PaginationState } from '../types.mjs';
import 'lucide-react';

type SessionsControlsProps = {
    controls: SessionControls;
    pagination: PaginationState;
    onSearchValueChange?: (value: string) => void;
    onDirectoryValueChange?: (value: string) => void;
    onSortValueChange?: (value: string) => void;
    onSortDirectionChange?: (descending: boolean) => void;
    onRefresh?: () => void;
    onHarnessValueChange?: (value: string) => void;
    onStatusValueChange?: (value: string) => void;
    onPageChange?: (page: number) => void;
};
declare function SessionsControls({ controls, pagination, onSearchValueChange, onDirectoryValueChange, onSortValueChange, onSortDirectionChange, onRefresh, onHarnessValueChange, onStatusValueChange, onPageChange, }: SessionsControlsProps): React.JSX.Element;

export { SessionsControls };
