import * as React from 'react';
import { ArtifactRepositorySnapshot } from '@repo/api/src/types/document';

type ArtifactRepositoriesSummaryProps = {
    snapshot: ArtifactRepositorySnapshot;
    /**
     * "horizontal" = inline pills for metadata bars; "vertical" = stacked block
     * for sidebar/detail layouts. Default "horizontal".
     */
    layout?: "horizontal" | "vertical";
    /**
     * Vertical-layout only: section title rendered above the repo list.
     */
    title?: string;
    /**
     * Vertical-layout only: whether to render the top-border separator.
     */
    separator?: boolean;
};
/**
 * Read-only summary of the repositories an artifact was created against.
 * The primary repo is ordered first, marked visually, and any branch/ref
 * hints are shown as secondary text.
 */
declare function ArtifactRepositoriesSummary({ snapshot, layout, title, separator, }: Readonly<ArtifactRepositoriesSummaryProps>): React.JSX.Element;

export { ArtifactRepositoriesSummary, type ArtifactRepositoriesSummaryProps };
