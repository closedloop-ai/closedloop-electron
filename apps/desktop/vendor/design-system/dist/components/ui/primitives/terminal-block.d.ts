import * as React from 'react';

type TerminalBlockProps = {
    command?: string;
    description?: string;
    label?: string;
    text?: string;
    stream?: "stdout" | "stderr";
};
declare function TerminalBlock({ command, description, label, text, stream, }: TerminalBlockProps): React.JSX.Element;

export { TerminalBlock };
