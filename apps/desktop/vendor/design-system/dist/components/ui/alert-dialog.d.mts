import * as React from 'react';
import { AlertDialog as AlertDialog$1 } from 'radix-ui';

declare function AlertDialog({ ...props }: React.ComponentProps<typeof AlertDialog$1.Root>): React.JSX.Element;
declare function AlertDialogTrigger({ ...props }: React.ComponentProps<typeof AlertDialog$1.Trigger>): React.JSX.Element;
declare function AlertDialogPortal({ ...props }: React.ComponentProps<typeof AlertDialog$1.Portal>): React.JSX.Element;
declare function AlertDialogOverlay({ className, ...props }: React.ComponentProps<typeof AlertDialog$1.Overlay>): React.JSX.Element;
declare function AlertDialogContent({ className, ...props }: React.ComponentProps<typeof AlertDialog$1.Content>): React.JSX.Element;
declare function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialog$1.Title>): React.JSX.Element;
declare function AlertDialogDescription({ className, ...props }: React.ComponentProps<typeof AlertDialog$1.Description>): React.JSX.Element;
declare function AlertDialogAction({ className, ...props }: React.ComponentProps<typeof AlertDialog$1.Action>): React.JSX.Element;
declare function AlertDialogCancel({ className, ...props }: React.ComponentProps<typeof AlertDialog$1.Cancel>): React.JSX.Element;

export { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogOverlay, AlertDialogPortal, AlertDialogTitle, AlertDialogTrigger };
