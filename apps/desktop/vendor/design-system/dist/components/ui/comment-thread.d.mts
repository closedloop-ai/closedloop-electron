import * as React from 'react';
import { ReactNode, MouseEventHandler, KeyboardEventHandler, ComponentPropsWithoutRef } from 'react';

type CommentThreadCardProps = {
    children: ReactNode;
    className?: string;
    interactive?: boolean;
    selected?: boolean;
    onClick?: MouseEventHandler<HTMLDivElement>;
    onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
    tabIndex?: number;
    testId?: string;
} & Omit<ComponentPropsWithoutRef<"div">, "children" | "className" | "onClick" | "onKeyDown" | "tabIndex">;
declare function CommentThreadCard({ children, className, interactive, onClick, onKeyDown, selected, tabIndex, testId, ...props }: Readonly<CommentThreadCardProps>): React.JSX.Element;
type CommentThreadMainProps = {
    avatar: ReactNode;
    content: ReactNode;
    actions?: ReactNode;
    className?: string;
};
declare function CommentThreadMain({ actions, avatar, className, content, }: Readonly<CommentThreadMainProps>): React.JSX.Element;
type CommentThreadHeaderProps = {
    author: ReactNode;
    metadata?: ReactNode;
    className?: string;
};
declare function CommentThreadHeader({ author, className, metadata, }: Readonly<CommentThreadHeaderProps>): React.JSX.Element;
type CommentThreadRepliesProps = {
    children: ReactNode;
    className?: string;
    label?: ReactNode;
    showDivider?: boolean;
};
declare function CommentThreadReplies({ children, className, label, showDivider, }: Readonly<CommentThreadRepliesProps>): React.JSX.Element;
type CommentThreadReplyRowProps = {
    avatar: ReactNode;
    header: ReactNode;
    body: ReactNode;
    actions?: ReactNode;
};
declare function CommentThreadReplyRow({ actions, avatar, body, header, }: Readonly<CommentThreadReplyRowProps>): React.JSX.Element;
type CommentThreadBannerProps = {
    children: ReactNode;
    className?: string;
};
declare function CommentThreadBanner({ children, className, }: Readonly<CommentThreadBannerProps>): React.JSX.Element;
type CommentThreadAnchorPreviewProps = {
    children: ReactNode;
    className?: string;
};
declare function CommentThreadAnchorPreview({ children, className, }: Readonly<CommentThreadAnchorPreviewProps>): React.JSX.Element;
type CommentThreadCollapseFooterProps = {
    label: string;
    onClick: MouseEventHandler<HTMLButtonElement>;
} & Omit<ComponentPropsWithoutRef<"button">, "onClick" | "children" | "type">;
declare function CommentThreadCollapseFooter({ className, label, onClick, ...props }: Readonly<CommentThreadCollapseFooterProps>): React.JSX.Element;

export { CommentThreadAnchorPreview, CommentThreadBanner, CommentThreadCard, CommentThreadCollapseFooter, CommentThreadHeader, CommentThreadMain, CommentThreadReplies, CommentThreadReplyRow };
