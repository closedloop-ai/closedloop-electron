import * as React from 'react';
import { ConversationMessageRole } from './conversation-message.js';

type ConversationMessageItem = {
    id: string;
    role: ConversationMessageRole;
    content: string;
};
type ConversationTranscriptProps = {
    messages: ConversationMessageItem[];
    className?: string;
};
declare function ConversationTranscript({ messages, className, }: Readonly<ConversationTranscriptProps>): React.JSX.Element;

export { type ConversationMessageItem, ConversationTranscript, type ConversationTranscriptProps };
