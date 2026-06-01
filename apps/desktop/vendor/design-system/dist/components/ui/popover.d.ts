import * as React from 'react';
import { Popover as Popover$1 } from 'radix-ui';

declare function Popover({ ...props }: React.ComponentProps<typeof Popover$1.Root>): React.JSX.Element;
declare function PopoverTrigger({ ...props }: React.ComponentProps<typeof Popover$1.Trigger>): React.JSX.Element;
declare function PopoverContent({ className, align, sideOffset, ...props }: React.ComponentProps<typeof Popover$1.Content>): React.JSX.Element;
declare function PopoverAnchor({ ...props }: React.ComponentProps<typeof Popover$1.Anchor>): React.JSX.Element;

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
