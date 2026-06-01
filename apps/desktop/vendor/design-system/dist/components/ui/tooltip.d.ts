import * as React from 'react';
import { Tooltip as Tooltip$1 } from 'radix-ui';

declare function TooltipProvider({ delayDuration, ...props }: React.ComponentProps<typeof Tooltip$1.Provider>): React.JSX.Element;
declare function Tooltip({ ...props }: React.ComponentProps<typeof Tooltip$1.Root>): React.JSX.Element;
declare function TooltipTrigger({ ...props }: React.ComponentProps<typeof Tooltip$1.Trigger>): React.JSX.Element;
declare function TooltipContent({ className, sideOffset, children, ...props }: React.ComponentProps<typeof Tooltip$1.Content>): React.JSX.Element;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
