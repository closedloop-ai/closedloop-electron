import * as React from 'react';
import { DropdownMenu as DropdownMenu$1 } from 'radix-ui';

declare function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenu$1.Root>): React.JSX.Element;
declare function DropdownMenuPortal({ ...props }: React.ComponentProps<typeof DropdownMenu$1.Portal>): React.JSX.Element;
declare function DropdownMenuTrigger({ id: idProp, ...props }: React.ComponentProps<typeof DropdownMenu$1.Trigger>): React.JSX.Element;
declare function DropdownMenuContent({ className, sideOffset, ...props }: React.ComponentProps<typeof DropdownMenu$1.Content>): React.JSX.Element;
declare function DropdownMenuGroup({ ...props }: React.ComponentProps<typeof DropdownMenu$1.Group>): React.JSX.Element;
declare function DropdownMenuItem({ className, inset, variant, ...props }: React.ComponentProps<typeof DropdownMenu$1.Item> & {
    inset?: boolean;
    variant?: "default" | "destructive";
}): React.JSX.Element;
declare function DropdownMenuCheckboxItem({ className, children, checked, ...props }: React.ComponentProps<typeof DropdownMenu$1.CheckboxItem>): React.JSX.Element;
declare function DropdownMenuRadioGroup({ ...props }: React.ComponentProps<typeof DropdownMenu$1.RadioGroup>): React.JSX.Element;
declare function DropdownMenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof DropdownMenu$1.RadioItem>): React.JSX.Element;
declare function DropdownMenuLabel({ className, inset, ...props }: React.ComponentProps<typeof DropdownMenu$1.Label> & {
    inset?: boolean;
}): React.JSX.Element;
declare function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenu$1.Separator>): React.JSX.Element;
declare function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">): React.JSX.Element;
declare function DropdownMenuSub({ ...props }: React.ComponentProps<typeof DropdownMenu$1.Sub>): React.JSX.Element;
declare function DropdownMenuSubTrigger({ className, inset, children, ...props }: React.ComponentProps<typeof DropdownMenu$1.SubTrigger> & {
    inset?: boolean;
}): React.JSX.Element;
declare function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof DropdownMenu$1.SubContent>): React.JSX.Element;

export { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger };
