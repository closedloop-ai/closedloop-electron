import * as React from 'react';
import { Pack, Harness } from '../types.js';
import 'lucide-react';

type PackCardProps = {
    pack: Pack;
    selected?: boolean;
    onSelect?: (packId: string) => void;
    onInstallPack?: (packId: string, harness: Harness) => void;
};
declare function PackCard({ pack, selected, onSelect, onInstallPack, }: PackCardProps): React.JSX.Element;

export { PackCard };
