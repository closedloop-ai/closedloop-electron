import * as React from 'react';
import { Drawer as Drawer$1 } from 'vaul';

declare function Drawer({ ...props }: React.ComponentProps<typeof Drawer$1.Root>): React.JSX.Element;
declare function DrawerTrigger({ ...props }: React.ComponentProps<typeof Drawer$1.Trigger>): React.JSX.Element;
declare function DrawerPortal({ ...props }: React.ComponentProps<typeof Drawer$1.Portal>): React.JSX.Element;
declare function DrawerClose({ ...props }: React.ComponentProps<typeof Drawer$1.Close>): React.JSX.Element;
declare function DrawerOverlay({ className, ...props }: React.ComponentProps<typeof Drawer$1.Overlay>): React.JSX.Element;
declare function DrawerContent({ className, children, ...props }: React.ComponentProps<typeof Drawer$1.Content>): React.JSX.Element;
declare function DrawerHeader({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function DrawerFooter({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function DrawerTitle({ className, ...props }: React.ComponentProps<typeof Drawer$1.Title>): React.JSX.Element;
declare function DrawerDescription({ className, ...props }: React.ComponentProps<typeof Drawer$1.Description>): React.JSX.Element;

export { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerOverlay, DrawerPortal, DrawerTitle, DrawerTrigger };
