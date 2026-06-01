import * as React from 'react';

type GrepMatch = {
    file?: string;
    line?: number;
    text?: string;
};
type MatchListProps = {
    matches: GrepMatch[];
};
declare function MatchList({ matches }: MatchListProps): React.JSX.Element;

export { type GrepMatch, MatchList };
