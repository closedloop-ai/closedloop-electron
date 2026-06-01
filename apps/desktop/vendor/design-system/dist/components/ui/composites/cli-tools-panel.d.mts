import * as React from 'react';
import { CliTool } from '../types.mjs';
import 'lucide-react';

type CliToolsPanelProps = {
    tools: CliTool[];
    pathValues?: Record<string, string>;
    onPathChange?: (toolId: string, value: string) => void;
    onSavePath?: (tool: CliTool, value: string) => void;
    onResetPath?: (tool: CliTool) => void;
};
declare function CliToolsPanel({ tools, pathValues, onPathChange, onSavePath, onResetPath, }: CliToolsPanelProps): React.JSX.Element;

export { CliToolsPanel };
