import * as React from 'react';
import { Dialog } from 'radix-ui';

declare function Sheet({ ...props }: React.ComponentProps<typeof Dialog.Root>): React.JSX.Element;
declare function SheetTrigger({ ...props }: React.ComponentProps<typeof Dialog.Trigger>): React.JSX.Element;
declare function SheetClose({ ...props }: React.ComponentProps<typeof Dialog.Close>): React.JSX.Element;
declare function SheetContent({ className, children, side, ...props }: React.ComponentProps<typeof Dialog.Content> & {
    side?: "top" | "right" | "bottom" | "left";
}): React.JSX.Element;
declare function SheetHeader({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function SheetFooter({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function SheetTitle({ className, ...props }: React.ComponentProps<typeof Dialog.Title>): React.JSX.Element;
declare function SheetDescription({ className, ...props }: React.ComponentProps<typeof Dialog.Description>): React.JSX.Element;

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger };
