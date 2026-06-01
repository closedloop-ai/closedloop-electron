import { ReactNode } from 'react';
import { JsonValue } from '../types.mjs';
import 'lucide-react';

declare function ToolInputView({ toolName, input, }: {
    toolName: string | null | undefined;
    input: JsonValue;
}): ReactNode | null;
declare function ToolResponseView({ toolName, response, }: {
    toolName: string | null | undefined;
    response: JsonValue;
}): ReactNode | null;

export { ToolInputView, ToolResponseView };
