import * as React from 'react';
import { ScrollArea as ScrollArea$1 } from 'radix-ui';

declare function ScrollArea({ className, children, scrollbars, ...props }: React.ComponentProps<typeof ScrollArea$1.Root> & {
    scrollbars?: "vertical" | "horizontal" | "both";
}): React.JSX.Element;
declare function ScrollBar({ className, orientation, ...props }: React.ComponentProps<typeof ScrollArea$1.ScrollAreaScrollbar>): React.JSX.Element;

export { ScrollArea, ScrollBar };
