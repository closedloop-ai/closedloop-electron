import * as React from 'react';
import { Pack, PackInstallRun } from '../types.js';
import 'lucide-react';

type PackInstallDialogProps = {
    open: boolean;
    pack: Pack;
    run: PackInstallRun;
    onOpenChange?: (open: boolean) => void;
    onSelectProject?: (project: string) => void;
    onClose?: () => void;
    onRunCommand?: () => void;
    onCopyCommand?: () => void;
};
declare function PackInstallDialog({ open, pack, run, onOpenChange, onSelectProject, onClose, onRunCommand, onCopyCommand, }: PackInstallDialogProps): React.JSX.Element;

export { PackInstallDialog };
