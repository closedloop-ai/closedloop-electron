import * as React from 'react';
import { ReactNode } from 'react';
import { FileAttachment } from '@repo/api/src/types/attachment';

type AttachmentListProps = {
    attachments: FileAttachment[];
    className?: string;
    onDownload?: (attachment: FileAttachment) => void;
    onDelete?: (attachment: FileAttachment) => void;
    actionVisibility?: "hover" | "always";
    emptyState?: ReactNode;
};
/**
 * Wrap-enabled list of attachment chips for artifact detail surfaces.
 * Image attachments link to their preview URL; non-image files expose a
 * download action when a handler is provided.
 */
declare function AttachmentList({ attachments, className, onDownload, onDelete, actionVisibility, emptyState, }: Readonly<AttachmentListProps>): string | number | bigint | boolean | Iterable<ReactNode> | Promise<string | number | bigint | boolean | React.ReactPortal | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<ReactNode> | null | undefined> | React.JSX.Element | null;

export { AttachmentList, type AttachmentListProps };
