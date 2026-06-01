import * as React from 'react';
import { PrCommentAuthorKind } from '@repo/api/src/types/branch-view';

type CommentAvatarSize = "md" | "sm" | "xs";
type CommentAvatarProps = {
    author: string;
    authorAvatar?: string | null;
    authorKind?: PrCommentAuthorKind;
    size?: CommentAvatarSize;
};
declare function getCommentAuthorInitials(author: string): string;
declare function CommentAvatar({ author, authorAvatar, authorKind, size, }: Readonly<CommentAvatarProps>): React.JSX.Element;

export { CommentAvatar, type CommentAvatarProps, type CommentAvatarSize, getCommentAuthorInitials };
