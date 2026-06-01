import * as React from 'react';
import { Command as Command$1 } from 'cmdk';
import { Dialog } from './dialog.js';
import 'radix-ui';

declare function Command({ className, ...props }: React.ComponentProps<typeof Command$1>): React.JSX.Element;
declare function CommandDialog({ title, description, children, className, showCloseButton, ...props }: React.ComponentProps<typeof Dialog> & {
    title?: string;
    description?: string;
    className?: string;
    showCloseButton?: boolean;
}): React.JSX.Element;
declare function CommandInput({ className, ...props }: React.ComponentProps<typeof Command$1.Input>): React.JSX.Element;
declare function CommandList({ className, ...props }: React.ComponentProps<typeof Command$1.List>): React.JSX.Element;
declare function CommandEmpty({ ...props }: React.ComponentProps<typeof Command$1.Empty>): React.JSX.Element;
declare function CommandGroup({ className, ...props }: React.ComponentProps<typeof Command$1.Group>): React.JSX.Element;
declare function CommandSeparator({ className, ...props }: React.ComponentProps<typeof Command$1.Separator>): React.JSX.Element;
declare function CommandItem({ className, ...props }: React.ComponentProps<typeof Command$1.Item>): React.JSX.Element;
declare function CommandShortcut({ className, ...props }: React.ComponentProps<"span">): React.JSX.Element;

export { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut };
