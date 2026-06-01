import { BadgeProps } from './badge.mjs';
import { Tone, ConversationMessage, ConversationEnvelope, JsonValue } from './types.mjs';
import 'class-variance-authority/types';
import 'react';
import 'class-variance-authority';
import 'lucide-react';

declare const badgeClassName = "rounded-md px-1.5 py-0.5 font-medium text-[10px]";
declare function getBadgeVariant(tone?: Tone): NonNullable<BadgeProps["variant"]>;
declare function formatCurrency(value: number): string;
declare function formatRelativeLabel(iso: string): string;
declare function formatDateTime(iso: string): string;
declare function truncateMiddle(value: string, max?: number): string;
declare function formatDurationSeconds(value: number): string;
declare function formatCompactNumber(value: number): string;
declare function formatTokenCount(count: number): string;
type TuiSegment = {
    kind: "caveat";
    text: string;
} | {
    kind: "stdout";
    text: string;
} | {
    kind: "stderr";
    text: string;
} | {
    kind: "system-reminder";
    text: string;
} | {
    kind: "persisted-output";
    text: string;
} | {
    kind: "command";
    display: string;
} | {
    kind: "text";
    text: string;
};
declare function stripAnsi(text: string): string;
declare function parseTuiSegments(input: string): TuiSegment[];
declare function hasTuiTags(input: string): boolean;
declare function formatLocalTime(iso: string): string;
declare function stringifyJsonValue(value: JsonValue): string;
declare function messagesToEnvelopes(messages: ConversationMessage[]): ConversationEnvelope[];

export { type TuiSegment, badgeClassName, formatCompactNumber, formatCurrency, formatDateTime, formatDurationSeconds, formatLocalTime, formatRelativeLabel, formatTokenCount, getBadgeVariant, hasTuiTags, messagesToEnvelopes, parseTuiSegments, stringifyJsonValue, stripAnsi, truncateMiddle };
