import * as React from 'react';
import { ReactNode } from 'react';

declare const FeedRailTab: {
    readonly Feed: "feed";
    readonly Chat: "chat";
};
type FeedRailTab = (typeof FeedRailTab)[keyof typeof FeedRailTab];
type FeedRailProps = {
    visible: boolean;
    onClose: () => void;
    width: number;
    onWidthChange: (nextWidth: number) => void;
    activeTab: FeedRailTab;
    hasChat: boolean;
    onTabChange: (next: FeedRailTab) => void;
    feedPanel: ReactNode;
    chatPanel?: ReactNode;
};
declare function FeedRail({ visible, onClose, width, onWidthChange, activeTab, hasChat, onTabChange, feedPanel, chatPanel, }: Readonly<FeedRailProps>): React.JSX.Element | null;

export { FeedRail, FeedRailTab };
