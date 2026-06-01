import * as React from 'react';

type DiffHunk = {
    oldStart: number;
    newStart: number;
    oldLines: number;
    newLines: number;
    lines: string[];
};
type UnifiedDiffProps = {
    hunks: DiffHunk[];
};
declare function UnifiedDiff({ hunks }: UnifiedDiffProps): React.JSX.Element;

export { type DiffHunk, UnifiedDiff };
