import * as React from 'react';
import { ConversationContentBlock } from '../types.mjs';
import 'lucide-react';

type ToolResultBlockProps = {
    result: Extract<ConversationContentBlock, {
        type: "tool_result";
    }>;
    defaultExpanded?: boolean;
};
declare function ToolResultBlock({ result, defaultExpanded, }: ToolResultBlockProps): React.JSX.Element;

export { ToolResultBlock };
