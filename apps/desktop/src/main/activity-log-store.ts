import { randomUUID } from "node:crypto";
import Store from "electron-store";

export type ActivityEvent = {
  id: string;
  type?: "request" | "security";
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  detail?: string;
  requestBody?: string;
  responseBody?: string;
};

type ActivityStoreSchema = {
  events: ActivityEvent[];
};

const MAX_BODY_LENGTH = 8_192;

export interface ActivityLogStoreOptions {
  maxEntries?: number;
  cwd?: string;
  name?: string;
}

export class ActivityLogStore {
  private readonly maxEntries: number;
  private readonly events: ActivityEvent[];
  private readonly store: Store<ActivityStoreSchema>;

  constructor(options?: ActivityLogStoreOptions | number) {
    const opts = typeof options === "number" ? { maxEntries: options } : options;
    this.maxEntries = opts?.maxEntries ?? 200;
    this.store = new Store<ActivityStoreSchema>({
      name: opts?.name ?? "desktop-activity-log",
      cwd: opts?.cwd,
      defaults: {
        events: []
      }
    });
    const persistedEvents = this.store.get("events", []);
    const raw = Array.isArray(persistedEvents) ? persistedEvents : [];
    this.events = raw.slice(0, this.maxEntries);
    // Migrate: truncate oversized bodies from existing events and persist
    let needsPersist = raw.length > this.maxEntries;
    for (const event of this.events) {
      const trimmedReq = truncateBody(event.requestBody);
      const trimmedRes = truncateBody(event.responseBody);
      if (trimmedReq !== event.requestBody || trimmedRes !== event.responseBody) {
        event.requestBody = trimmedReq;
        event.responseBody = trimmedRes;
        needsPersist = true;
      }
    }
    if (needsPersist) {
      this.persist();
    }
  }

  add(event: Omit<ActivityEvent, "id">): ActivityEvent {
    const withId: ActivityEvent = {
      id: randomUUID(),
      ...event,
      requestBody: truncateBody(event.requestBody),
      responseBody: truncateBody(event.responseBody),
    };
    this.events.unshift(withId);
    if (this.events.length > this.maxEntries) {
      this.events.length = this.maxEntries;
    }
    this.persist();
    return withId;
  }

  list(): ActivityEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
    this.persist();
  }

  private persist(): void {
    this.store.set("events", this.events);
  }
}

function truncateBody(body: string | undefined): string | undefined {
  if (!body || body.length <= MAX_BODY_LENGTH) {
    return body;
  }
  return `${body.slice(0, MAX_BODY_LENGTH)}… (truncated, ${body.length} chars total)`;
}
