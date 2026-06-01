import * as class_variance_authority_types from 'class-variance-authority/types';
import * as React from 'react';
import { VariantProps } from 'class-variance-authority';

declare const chipVariants: (props?: ({
    variant?: "default" | "destructive" | "outline" | "secondary" | "success" | "warning" | "info" | "accent" | "muted" | null | undefined;
    size?: "default" | "sm" | "lg" | null | undefined;
    interactive?: boolean | null | undefined;
} & class_variance_authority_types.ClassProp) | undefined) => string;
declare function Chip({ className, variant, size, interactive, asChild, ...props }: React.ComponentProps<"span"> & VariantProps<typeof chipVariants> & {
    asChild?: boolean;
}): React.JSX.Element;

export { Chip, chipVariants };
