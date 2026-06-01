import * as React from 'react';

type ConversationMessageRole = "user" | "assistant";
type ConversationMessageProps = {
    role: ConversationMessageRole;
    content: string;
    className?: string;
};
declare function ConversationMessage({ role, content, className, }: Readonly<ConversationMessageProps>): React.JSX.Element;

export { ConversationMessage, type ConversationMessageProps, type ConversationMessageRole };
