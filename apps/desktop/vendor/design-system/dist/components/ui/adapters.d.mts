import { RawDashboardEvent, SessionEventGroup, SessionEvent, RawTranscriptMessage, ConversationMessage, ConversationEnvelope, EventDetail } from './types.mjs';
import 'lucide-react';
import 'react';

declare function statusFromEventType(eventType: string): SessionEvent["status"];
declare function formatGroupDuration(durationMs: number | null): string | undefined;
declare function projectFromRawEvent(event: RawDashboardEvent): string | null;
declare function buildEventTitle(event: RawDashboardEvent): string;
declare function buildEventDetailFromRawEvent(event: RawDashboardEvent): EventDetail | null;
declare function adaptRawDashboardEvent(event: RawDashboardEvent): SessionEvent;
declare function adaptGroupedRawDashboardEvents(events: RawDashboardEvent[]): SessionEventGroup[];
declare function adaptRawTranscriptMessages(messages: RawTranscriptMessage[], author?: string): ConversationMessage[];
declare function adaptRawTranscriptToEnvelopes(messages: RawTranscriptMessage[], author?: string): ConversationEnvelope[];

export { adaptGroupedRawDashboardEvents, adaptRawDashboardEvent, adaptRawTranscriptMessages, adaptRawTranscriptToEnvelopes, buildEventDetailFromRawEvent, buildEventTitle, formatGroupDuration, projectFromRawEvent, statusFromEventType };
