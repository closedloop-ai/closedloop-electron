import * as class_variance_authority_types from 'class-variance-authority/types';
import * as React from 'react';
import { NavigationMenu as NavigationMenu$1 } from 'radix-ui';

declare function NavigationMenu({ className, children, viewport, ...props }: React.ComponentProps<typeof NavigationMenu$1.Root> & {
    viewport?: boolean;
}): React.JSX.Element;
declare function NavigationMenuList({ className, ...props }: React.ComponentProps<typeof NavigationMenu$1.List>): React.JSX.Element;
declare function NavigationMenuItem({ className, ...props }: React.ComponentProps<typeof NavigationMenu$1.Item>): React.JSX.Element;
declare const navigationMenuTriggerStyle: (props?: class_variance_authority_types.ClassProp | undefined) => string;
declare function NavigationMenuTrigger({ className, children, ...props }: React.ComponentProps<typeof NavigationMenu$1.Trigger>): React.JSX.Element;
declare function NavigationMenuContent({ className, ...props }: React.ComponentProps<typeof NavigationMenu$1.Content>): React.JSX.Element;
declare function NavigationMenuViewport({ className, ...props }: React.ComponentProps<typeof NavigationMenu$1.Viewport>): React.JSX.Element;
declare function NavigationMenuLink({ className, ...props }: React.ComponentProps<typeof NavigationMenu$1.Link>): React.JSX.Element;
declare function NavigationMenuIndicator({ className, ...props }: React.ComponentProps<typeof NavigationMenu$1.Indicator>): React.JSX.Element;

export { NavigationMenu, NavigationMenuContent, NavigationMenuIndicator, NavigationMenuItem, NavigationMenuLink, NavigationMenuList, NavigationMenuTrigger, NavigationMenuViewport, navigationMenuTriggerStyle };
