import * as React from 'react';
import { ComponentPropsWithoutRef } from 'react';

type PullRequestChipProps = {
    repo: string;
    number: number;
    title?: string;
    href?: string;
    className?: string;
} & Omit<ComponentPropsWithoutRef<"button">, "children">;
declare function PullRequestChip({ repo, number, title, href, className, ...props }: PullRequestChipProps): React.JSX.Element;

export { PullRequestChip };
