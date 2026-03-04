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

export class ActivityLogStore {
  private readonly maxEntries: number;
  private readonly events: ActivityEvent[];
  private readonly store: Store<ActivityStoreSchema>;

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries;
    this.store = new Store<ActivityStoreSchema>({
      name: "desktop-activity-log",
      defaults: {
        events: []
      }
    });
    const persistedEvents = this.store.get("events", []);
    this.events = Array.isArray(persistedEvents)
      ? persistedEvents.slice(0, this.maxEntries)
      : [];
  }

  add(event: Omit<ActivityEvent, "id">): ActivityEvent {
    const withId: ActivityEvent = {
      id: randomUUID(),
      ...event
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
