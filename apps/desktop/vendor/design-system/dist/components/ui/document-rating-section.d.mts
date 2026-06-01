import * as React from 'react';

type DocumentRatingSummaryViewModel = {
    average: number;
    count: number;
    userRating: {
        score: number;
        comment?: string | null;
        documentVersion: number;
    } | null;
};
type DocumentRatingSectionProps = {
    summary?: DocumentRatingSummaryViewModel | null;
    currentDocumentVersion: number;
    selectedScore?: number | null;
    commentDraft: string;
    isLoading?: boolean;
    isSaving?: boolean;
    onScoreChange?: (score: number) => void;
    onCommentChange?: (value: string) => void;
    onCancelComment?: () => void;
    onSaveComment?: () => void;
};
declare function DocumentRatingSection({ summary, currentDocumentVersion, selectedScore, commentDraft, isLoading, isSaving, onScoreChange, onCommentChange, onCancelComment, onSaveComment, }: Readonly<DocumentRatingSectionProps>): React.JSX.Element;

export { DocumentRatingSection, type DocumentRatingSummaryViewModel };
