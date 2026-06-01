import * as class_variance_authority_types from 'class-variance-authority/types';
import * as React from 'react';
import { VariantProps } from 'class-variance-authority';

declare const badgeVariants: (props?: ({
    variant?: "default" | "destructive" | "outline" | "secondary" | "success" | "warning" | "info" | "accent" | "muted" | null | undefined;
} & class_variance_authority_types.ClassProp) | undefined) => string;
declare function Badge({ className, variant, asChild, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & {
    asChild?: boolean;
}): React.JSX.Element;
type BadgeProps = React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & {
    asChild?: boolean;
};

export { Badge, type BadgeProps, badgeVariants };
