import * as React from 'react';
import { ConversationContentBlock } from '../types.mjs';
import 'lucide-react';

type ToolCallBlockProps = {
    toolUse: Extract<ConversationContentBlock, {
        type: "tool_use";
    }>;
    toolResult?: Extract<ConversationContentBlock, {
        type: "tool_result";
    }> | null;
};
declare function ToolCallBlock({ toolUse, toolResult, }: ToolCallBlockProps): React.JSX.Element;

export { ToolCallBlock };
