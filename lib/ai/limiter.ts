/**
 * Per-model rate limiting.
 *
 * Free-tier quota is metered per model — measured on Gemini: 20 requests per
 * minute, each model counted separately. One clone costs 2–4 calls, so a batch
 * of fifty will hit that ceiling repeatedly.
 *
 * Today the app discovers the limit by being refused: fire, take a 429, switch
 * model or back off. That works for one ad and wastes most of the wall clock
 * for fifty. A token bucket makes the wait happen *before* the request instead
 * of after the rejection.
 *
 * This does not replace `withModelFallback` — it removes the predictable
 * failures so the fallback is left handling the genuinely unpredictable ones
 * (503s, quota resets, another process sharing the same key).
 */

export type BucketOptions = {
  /** Requests allowed per window. */
  capacity: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Injectable clock, so tests do not wait out real minutes. */
  now?: () => number;
};

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor({ capacity, windowMs, now = Date.now }: BucketOptions) {
    this.capacity = capacity;
    this.windowMs = windowMs;
    this.now = now;
    this.tokens = capacity;
    this.lastRefill = now();
  }

  /** Tokens trickle back continuously rather than all at once on the minute. */
  private refill(): void {
    const elapsed = this.now() - this.lastRefill;
    if (elapsed <= 0) return;

    const gained = (elapsed / this.windowMs) * this.capacity;
    if (gained < 1 && this.tokens < this.capacity) {
      // Keep the remainder by only advancing the clock we have consumed.
      return;
    }

    this.tokens = Math.min(this.capacity, this.tokens + gained);
    this.lastRefill = this.now();
  }

  /** How long until a token is free. 0 when one is available now. */
  msUntilToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    const deficit = 1 - this.tokens;
    return Math.ceil((deficit / this.capacity) * this.windowMs);
  }

  /** Take a token if one is free. */
  tryTake(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  get available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

const buckets = new Map<string, TokenBucket>();

/** Gemini's published free-tier allowance, and a safe default elsewhere. */
export const DEFAULT_RPM = 20;

export function bucketFor(modelId: string, rpm = DEFAULT_RPM): TokenBucket {
  let bucket = buckets.get(modelId);
  if (!bucket) {
    bucket = new TokenBucket({ capacity: rpm, windowMs: 60_000 });
    buckets.set(modelId, bucket);
  }
  return bucket;
}

/** Test seam — buckets are process-global by design. */
export function resetBuckets(): void {
  buckets.clear();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until this model has quota, then run.
 *
 * `maxWaitMs` matters: when the caller has other models to try, waiting 40
 * seconds for this one is worse than moving on. It returns `null` rather than
 * throwing so the caller can treat "busy" as a routing decision, not an error.
 */
export async function withRateLimit<T>(
  modelId: string,
  fn: () => Promise<T>,
  opts: { rpm?: number; maxWaitMs?: number; onWait?: (ms: number) => void } = {},
): Promise<T | null> {
  const bucket = bucketFor(modelId, opts.rpm);
  const maxWait = opts.maxWaitMs ?? 0;

  if (!bucket.tryTake()) {
    const wait = bucket.msUntilToken();
    if (wait > maxWait) return null;

    opts.onWait?.(wait);
    await sleep(wait);

    // Another caller may have taken the token while we slept.
    if (!bucket.tryTake()) return null;
  }

  return fn();
}
