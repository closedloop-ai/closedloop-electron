import * as React from 'react';
import { Tabs as Tabs$1 } from 'radix-ui';

declare function Tabs({ className, ...props }: React.ComponentProps<typeof Tabs$1.Root>): React.JSX.Element;
declare function TabsList({ className, ...props }: React.ComponentProps<typeof Tabs$1.List>): React.JSX.Element;
declare function TabsTrigger({ className, ...props }: React.ComponentProps<typeof Tabs$1.Trigger>): React.JSX.Element;
declare function TabsContent({ className, ...props }: React.ComponentProps<typeof Tabs$1.Content>): React.JSX.Element;

export { Tabs, TabsContent, TabsList, TabsTrigger };
