import { createHash } from "node:crypto";
import Store from "electron-store";
import type {
  GitActivityAddResult,
  GitActivityEvent,
  GitActivityEventInput,
  GitActivitySourceClient,
} from "../shared/git-activity-types.js";

export type { GitActivityEventInput };

const MAX_RETAINED = 1000;

interface GitActivityStoreSchema {
  /** Newest-first. Capped at MAX_RETAINED. */
  events: GitActivityEvent[];
  /** Mirror of settings.captureEngineerActivity for boot-time fast-path. */
  enabled: boolean;
}

export interface GitActivityStoreOptions {
  cwd?: string;
  name?: string;
}

/**
 * Local store of engineer GitHub activity events (FEA-1226 Phase 1).
 *
 * Privacy guarantee (AC6 in FEA-1226): when `enabled` is false, `add()` is a
 * no-op and returns "disabled". No event is written and no observer fires.
 * Toggling on/off does not clear retained history — the user controls that
 * with the explicit clear endpoint.
 */
export class GitActivityStore {
  private readonly store: Store<GitActivityStoreSchema>;
  private events: GitActivityEvent[];
  private enabled: boolean;
  private readonly listeners = new Set<() => void>();

  constructor(options?: GitActivityStoreOptions) {
    this.store = new Store<GitActivityStoreSchema>({
      name: options?.name ?? "desktop-git-activity",
      cwd: options?.cwd,
      defaults: {
        events: [],
        enabled: false,
      },
    });
    const persistedEvents = this.store.get("events", []);
    this.events = Array.isArray(persistedEvents)
      ? persistedEvents.slice(0, MAX_RETAINED)
      : [];
    this.enabled = this.store.get("enabled", false);
    if (this.events.length !== persistedEvents.length) {
      this.persistEvents();
    }
  }

  /** Persist the on/off toggle. Mirrors settings.captureEngineerActivity. */
  setEnabled(value: boolean): void {
    if (this.enabled === value) {
      return;
    }
    this.enabled = value;
    this.store.set("enabled", value);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Add an event to the store. Idempotent on `id` — duplicate adds are dropped
   * silently. Returns "disabled" if capture is currently off (privacy
   * guarantee — no write occurs in that case).
   */
  add(input: GitActivityEventInput): GitActivityAddResult {
    if (!this.enabled) {
      return "disabled";
    }
    const id = computeEventId(
      input.sourceClient,
      input.sourceSessionId,
      input.prUrl,
    );
    if (this.events.some((e) => e.id === id)) {
      return "duplicate";
    }
    const event: GitActivityEvent = {
      ...input,
      id,
      observedAt: input.observedAt ?? new Date().toISOString(),
    };
    this.events.unshift(event);
    if (this.events.length > MAX_RETAINED) {
      this.events.length = MAX_RETAINED;
    }
    this.persistEvents();
    this.notify();
    return "added";
  }

  list(opts: { sinceIso?: string; limit?: number } = {}): GitActivityEvent[] {
    let result = [...this.events];
    if (opts.sinceIso) {
      const since = opts.sinceIso;
      result = result.filter((e) => e.observedAt >= since);
    }
    if (opts.limit !== undefined && opts.limit >= 0) {
      result = result.slice(0, opts.limit);
    }
    return result;
  }

  /** Returns the number of events removed. */
  clear(): number {
    const count = this.events.length;
    if (count === 0) {
      return 0;
    }
    this.events = [];
    this.persistEvents();
    this.notify();
    return count;
  }

  /** Subscribe to add/clear events. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private persistEvents(): void {
    this.store.set("events", this.events);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Listener errors must not break the store. Swallow silently — the
        // tray-refresh listener is the only consumer in Phase 1 and is itself
        // best-effort.
      }
    }
  }
}

/** Exposed for parsers/tests that want to predict the id of an event. */
export function computeEventId(
  sourceClient: GitActivitySourceClient,
  sourceSessionId: string,
  prUrl: string,
): string {
  return createHash("sha256")
    .update(`${sourceClient}|${sourceSessionId}|${prUrl}`)
    .digest("hex")
    .slice(0, 16);
}
