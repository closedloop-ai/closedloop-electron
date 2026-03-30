import { PostHog } from "posthog-node";

export interface PostHogAnalyticsOptions {
  apiKey: string;
  host: string;
}

export class PostHogAnalytics {
  private readonly client: PostHog | null;

  constructor(options: PostHogAnalyticsOptions) {
    if (!options.apiKey) {
      this.client = null;
      return;
    }
    this.client = new PostHog(options.apiKey, {
      host: options.host,
      // Batch events, flush every 30s or 20 events
      flushAt: 20,
      flushInterval: 30_000,
    });
  }

  capture(
    distinctId: string,
    event: string,
    properties: Record<string, unknown>,
  ): void {
    try {
      this.client?.capture({ distinctId, event, properties });
    } catch {
      // Fire-and-forget — never throw
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.client?.shutdown();
    } catch {
      // Best-effort flush
    }
  }
}
