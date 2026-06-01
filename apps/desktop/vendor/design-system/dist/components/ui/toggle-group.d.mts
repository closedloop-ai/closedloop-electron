import * as React from 'react';
import { ToggleGroup as ToggleGroup$1 } from 'radix-ui';
import { VariantProps } from 'class-variance-authority';
import { toggleVariants } from './toggle.mjs';
import 'class-variance-authority/types';

declare function ToggleGroup({ className, variant, size, spacing, children, ...props }: React.ComponentProps<typeof ToggleGroup$1.Root> & VariantProps<typeof toggleVariants> & {
    spacing?: number;
}): React.JSX.Element;
declare function ToggleGroupItem({ className, children, variant, size, ...props }: React.ComponentProps<typeof ToggleGroup$1.Item> & VariantProps<typeof toggleVariants>): React.JSX.Element;

export { ToggleGroup, ToggleGroupItem };
