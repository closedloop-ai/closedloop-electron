import * as React from 'react';
import { Dialog as Dialog$1 } from 'radix-ui';

declare function Dialog({ ...props }: React.ComponentProps<typeof Dialog$1.Root>): React.JSX.Element;
declare function DialogTrigger({ ...props }: React.ComponentProps<typeof Dialog$1.Trigger>): React.JSX.Element;
declare function DialogPortal({ ...props }: React.ComponentProps<typeof Dialog$1.Portal>): React.JSX.Element;
declare function DialogClose({ ...props }: React.ComponentProps<typeof Dialog$1.Close>): React.JSX.Element;
declare function DialogOverlay({ className, ...props }: React.ComponentProps<typeof Dialog$1.Overlay>): React.JSX.Element;
declare function DialogContent({ className, children, showCloseButton, showOverlay, ...props }: React.ComponentProps<typeof Dialog$1.Content> & {
    showCloseButton?: boolean;
    showOverlay?: boolean;
}): React.JSX.Element;
declare function DialogHeader({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function DialogFooter({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function DialogTitle({ className, ...props }: React.ComponentProps<typeof Dialog$1.Title>): React.JSX.Element;
declare function DialogDescription({ className, ...props }: React.ComponentProps<typeof Dialog$1.Description>): React.JSX.Element;

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger };
