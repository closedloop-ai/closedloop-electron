import * as React from 'react';
import { ReactNode } from 'react';

type InlineEditEditorShellProps = {
    expanded: boolean;
    toolbar: ReactNode;
    children: ReactNode;
};
declare function InlineEditEditorShell({ expanded, toolbar, children, }: Readonly<InlineEditEditorShellProps>): React.JSX.Element;

export { InlineEditEditorShell };
