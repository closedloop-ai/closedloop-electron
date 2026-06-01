import * as React from 'react';
import { Select as Select$1 } from 'radix-ui';

declare function Select({ ...props }: React.ComponentProps<typeof Select$1.Root>): React.JSX.Element;
declare function SelectGroup({ ...props }: React.ComponentProps<typeof Select$1.Group>): React.JSX.Element;
declare function SelectValue({ ...props }: React.ComponentProps<typeof Select$1.Value>): React.JSX.Element;
declare function SelectTrigger({ className, size, children, ...props }: React.ComponentProps<typeof Select$1.Trigger> & {
    size?: "sm" | "default";
}): React.JSX.Element;
declare function SelectContent({ className, children, position, align, ...props }: React.ComponentProps<typeof Select$1.Content>): React.JSX.Element;
declare function SelectLabel({ className, ...props }: React.ComponentProps<typeof Select$1.Label>): React.JSX.Element;
declare function SelectItem({ className, children, ...props }: React.ComponentProps<typeof Select$1.Item>): React.JSX.Element;
declare function SelectSeparator({ className, ...props }: React.ComponentProps<typeof Select$1.Separator>): React.JSX.Element;
declare function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof Select$1.ScrollUpButton>): React.JSX.Element;
declare function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof Select$1.ScrollDownButton>): React.JSX.Element;

export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue };
