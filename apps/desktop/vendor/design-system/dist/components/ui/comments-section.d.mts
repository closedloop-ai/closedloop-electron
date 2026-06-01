import * as React from 'react';
import { PrCommentAuthorKind } from '@repo/api/src/types/branch-view';

type CommentAuthor = {
    name: string;
    avatarUrl?: string | null;
    kind?: PrCommentAuthorKind;
};
type CommentThreadItem = {
    id: string;
    author: CommentAuthor;
    body: string;
    createdAt: string;
    replies?: CommentThreadItem[];
};
type CommentsSectionProps = {
    documentId: string;
    defaultOpen?: boolean;
    comments?: CommentThreadItem[];
    draft?: string;
    disabled?: boolean;
    isSubmitting?: boolean;
    onDraftChange?: (value: string) => void;
    onSubmitComment?: (body: string) => void;
    onReply?: (commentId: string, body: string) => void;
};
declare function CommentsSection({ documentId: _documentId, defaultOpen, comments, draft, disabled, isSubmitting, onDraftChange, onSubmitComment, onReply, }: Readonly<CommentsSectionProps>): React.JSX.Element;

export { type CommentAuthor, type CommentThreadItem, CommentsSection };
