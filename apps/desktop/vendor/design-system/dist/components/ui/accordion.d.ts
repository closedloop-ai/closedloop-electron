import * as React from 'react';
import { Accordion as Accordion$1 } from 'radix-ui';

declare function Accordion({ ...props }: React.ComponentProps<typeof Accordion$1.Root>): React.JSX.Element;
declare function AccordionItem({ className, ...props }: React.ComponentProps<typeof Accordion$1.Item>): React.JSX.Element;
declare function AccordionTrigger({ className, children, ...props }: React.ComponentProps<typeof Accordion$1.Trigger>): React.JSX.Element;
declare function AccordionContent({ className, children, ...props }: React.ComponentProps<typeof Accordion$1.Content>): React.JSX.Element;

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
