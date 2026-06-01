import * as React from 'react';

type JudgeResultCardProps = {
    title: string;
    score: number;
    threshold: number;
    scoreLabel: string;
    justification?: string | null;
    defaultOpen?: boolean;
    editable?: boolean;
    inputValue?: string;
    validationError?: string | null;
    isSaving?: boolean;
    onInputChange?: (value: string) => void;
    onInputBlur?: () => void;
};
declare function JudgeResultCard({ title, score, threshold, scoreLabel, justification, defaultOpen, editable, inputValue, validationError, isSaving, onInputChange, onInputBlur, }: Readonly<JudgeResultCardProps>): React.JSX.Element;

export { JudgeResultCard };
