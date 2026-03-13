import { randomBytes, timingSafeEqual } from "node:crypto";

interface Session {
  tokenHash: Buffer;
  origin: string;
  expiresAt: number;
  createdAt: number;
}

const DEFAULT_TTL_SECONDS = 600;
const MAX_ACTIVE_SESSIONS = 8;

/** In-memory store for browser session tokens bound to request origins. */
export class LocalSessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly defaultTtlSeconds: number;

  constructor(defaultTtlSeconds = DEFAULT_TTL_SECONDS) {
    this.defaultTtlSeconds = defaultTtlSeconds;
  }

  /** Create a new session token bound to the given origin. */
  create(origin: string, ttlSeconds?: number): { sessionToken: string; expiresAt: string } {
    this.cleanup();

    if (this.sessions.size >= MAX_ACTIVE_SESSIONS) {
      const oldest = this.findOldestSession();
      if (oldest) {
        this.sessions.delete(oldest);
      }
    }

    const sessionToken = randomBytes(32).toString("hex");
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const expiresAt = Date.now() + ttl * 1000;

    this.sessions.set(sessionToken, {
      tokenHash: Buffer.from(sessionToken),
      origin,
      expiresAt,
      createdAt: Date.now(),
    });

    return {
      sessionToken,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  /** Validate a session token against the expected origin. */
  validate(token: string, origin: string): boolean {
    this.cleanup();

    const session = this.sessions.get(token);
    if (!session) {
      return false;
    }

    if (Date.now() >= session.expiresAt) {
      this.sessions.delete(token);
      return false;
    }

    const tokenBuffer = Buffer.from(token);
    if (tokenBuffer.length !== session.tokenHash.length) {
      return false;
    }
    if (!timingSafeEqual(tokenBuffer, session.tokenHash)) {
      return false;
    }

    return session.origin === origin;
  }

  /** Remove expired sessions. Returns the number removed. */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, session] of this.sessions) {
      if (now >= session.expiresAt) {
        this.sessions.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Clear all sessions (e.g. on gateway restart). */
  invalidateAll(): void {
    this.sessions.clear();
  }

  /** Number of non-expired active sessions. */
  get activeCount(): number {
    this.cleanup();
    return this.sessions.size;
  }

  private findOldestSession(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, session] of this.sessions) {
      if (session.createdAt < oldestTime) {
        oldestTime = session.createdAt;
        oldestKey = key;
      }
    }
    return oldestKey;
  }
}
