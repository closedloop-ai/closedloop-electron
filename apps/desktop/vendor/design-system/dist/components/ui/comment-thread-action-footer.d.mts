import * as React from 'react';
import { ReactNode } from 'react';

type CommentThreadActionFooterProps = {
    label: string;
    isPending?: boolean;
    icon?: ReactNode;
    onClick: () => void;
};
declare function CommentThreadActionFooter({ label, isPending, icon, onClick, }: Readonly<CommentThreadActionFooterProps>): React.JSX.Element;

export { CommentThreadActionFooter, type CommentThreadActionFooterProps };
