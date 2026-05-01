// Simple sliding-window rate limiter.
// Defaults: 5 requests per 10 seconds.
const DEFAULT_MAX = 5;
const DEFAULT_WINDOW_MS = 10_000;
// On 429: suspend new calls for 60 seconds.
const QUOTA_SUSPEND_MS = 60_000;

interface RateLimiterOpts {
  maxRequests?: number;
  windowMs?: number;
}

export class RateLimiter {
  private timestamps: number[] = [];
  private maxRequests: number;
  private windowMs: number;
  private suspendedUntil: number = 0;

  constructor(opts: RateLimiterOpts = {}) {
    this.maxRequests = opts.maxRequests ?? DEFAULT_MAX;
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  }

  /** Returns ms to wait before the request should be sent (0 = proceed immediately). */
  check(): number {
    const now = Date.now();

    // Quota suspension takes priority
    if (now < this.suspendedUntil) {
      return this.suspendedUntil - now;
    }

    // Evict expired timestamps
    const windowStart = now - this.windowMs;
    this.timestamps = this.timestamps.filter((t) => t > windowStart);

    if (this.timestamps.length < this.maxRequests) {
      this.timestamps.push(now);
      return 0;
    }

    // Must wait until the oldest timestamp expires
    const oldest = this.timestamps[0]!;
    return oldest + this.windowMs - now;
  }

  /** Call when a 429 is received. Suspends all new requests for QUOTA_SUSPEND_MS. */
  onQuotaError(): void {
    this.suspendedUntil = Date.now() + QUOTA_SUSPEND_MS;
  }

  get isSuspended(): boolean {
    return Date.now() < this.suspendedUntil;
  }

  get suspendedUntilMs(): number {
    return this.suspendedUntil;
  }
}

// Singleton for the main process
export const globalRateLimiter = new RateLimiter();
