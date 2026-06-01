import * as React from 'react';
import { ReactNode } from 'react';
import { SessionRow } from '../types.js';
import 'lucide-react';

type SessionTableProps = {
    rows: SessionRow[];
    emptyState?: ReactNode;
    getSessionHref?: (row: SessionRow) => string | undefined;
    renderSessionLink?: (row: SessionRow) => ReactNode;
    extraColumnLabel?: string;
    renderExtraColumn?: (row: SessionRow) => ReactNode;
};
declare function SessionTable({ rows, emptyState, getSessionHref, renderSessionLink, extraColumnLabel, renderExtraColumn, }: SessionTableProps): string | number | bigint | boolean | React.JSX.Element | Iterable<ReactNode> | Promise<string | number | bigint | boolean | React.ReactPortal | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<ReactNode> | null | undefined>;

export { SessionTable };
