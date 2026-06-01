import * as React from 'react';
import { ReactNode } from 'react';

type CollapsedCommentRowProps = {
    author: string;
    title: string | null;
    onExpand: () => void;
    avatar: ReactNode;
    statusLabel?: string;
};
declare function CollapsedCommentRow({ author, title, onExpand, avatar, statusLabel, }: Readonly<CollapsedCommentRowProps>): React.JSX.Element;

export { CollapsedCommentRow };
