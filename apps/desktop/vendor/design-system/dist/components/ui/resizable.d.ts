import * as React from 'react';
import { PanelResizeHandle, Panel, PanelGroup } from 'react-resizable-panels';

declare function ResizablePanelGroup({ className, ...props }: React.ComponentProps<typeof PanelGroup>): React.JSX.Element;
declare function ResizablePanel({ ...props }: React.ComponentProps<typeof Panel>): React.JSX.Element;
declare function ResizableHandle({ withHandle, className, ...props }: React.ComponentProps<typeof PanelResizeHandle> & {
    withHandle?: boolean;
}): React.JSX.Element;

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
