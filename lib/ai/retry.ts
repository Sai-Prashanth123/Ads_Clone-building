/**
 * Transient-failure retry for model calls.
 *
 * Free tiers return 503 "overloaded" and 429 often enough that a single blip
 * would otherwise throw away a run that is 30 seconds in. Only genuinely
 * transient conditions are retried — an auth failure or a zero quota will
 * never succeed on a second attempt, and retrying them just wastes the user's
 * time before showing the same error.
 */

const TRANSIENT =
  /high demand|overloaded|unavailable|temporarily|try again|503|502|504|ECONNRESET|ETIMEDOUT|fetch failed/i;

/** A hard stop: retrying cannot help. */
const PERMANENT = /limit:\s*0|api key|unauthor|invalid|permission|401|403|404/i;

export function isTransient(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  if (PERMANENT.test(raw)) return false;
  // Rate limits are transient only when the provider says to wait, not when
  // the free-tier allowance is structurally zero.
  return TRANSIENT.test(raw) || /rate.?limit|resource_exhausted|429/i.test(raw);
}

/**
 * Providers often state exactly how long to wait ("Please retry in 32.2s",
 * `retryDelay: "30s"`, a Retry-After header echoed into the message). Honouring
 * that beats guessing: a per-minute rate limit will not clear in the 1.5s a
 * naive backoff would wait, so every attempt burns for nothing.
 */
export function providerRetryHintMs(err: unknown): number | null {
  const raw = err instanceof Error ? err.message : String(err);

  const patterns = [
    /retry in\s+([\d.]+)\s*s/i,
    /retryDelay["':\s]+([\d.]+)s/i,
    /retry-after["':\s]+([\d.]+)/i,
  ];

  for (const pattern of patterns) {
    const seconds = Number(raw.match(pattern)?.[1]);
    // Cap it: a provider asking for ten minutes is not worth blocking on.
    if (Number.isFinite(seconds) && seconds > 0 && seconds <= 90) {
      return Math.ceil(seconds * 1000) + 500;
    }
  }

  return null;
}

/** A quota/rate condition that another model would not share. */
export function isQuotaLimited(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /quota|rate.?limit|resource_exhausted|429|limit:\s*\d+/i.test(raw);
}

/**
 * Try each model in turn, moving on when one is unavailable.
 *
 * Fall through on ANY transient failure, not just quota. Free-tier quota is
 * metered per model, and so is load: a 503 "overloaded" on one model says
 * nothing about the next, and switching immediately beats waiting out a
 * backoff on a model that is busy right now.
 *
 * Permanent failures still bubble up at once — a bad key or a retired model
 * fails identically everywhere, so trying three is just a slower way to show
 * the same error.
 */
export async function withModelFallback<T, M extends { id: string }>(
  models: M[],
  fn: (entry: M) => Promise<T>,
  opts: {
    onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
    onFallback?: (from: string, to: string, reason: "quota" | "busy") => void;
    baseDelayMs?: number;
  } = {},
): Promise<T> {
  if (models.length === 0) throw new Error("No model available.");

  let lastError: unknown;

  for (let i = 0; i < models.length; i++) {
    const entry = models[i];
    const isLast = i === models.length - 1;

    try {
      // Fewer in-place retries when there is somewhere else to go: waiting 45s
      // for one model is worse than trying the next immediately.
      return await withRetry(() => fn(entry), {
        attempts: isLast ? 3 : 1,
        onRetry: opts.onRetry,
        baseDelayMs: opts.baseDelayMs,
      });
    } catch (err) {
      lastError = err;
      if (isLast || !isTransient(err)) throw err;
      opts.onFallback?.(
        entry.id,
        models[i + 1].id,
        isQuotaLimited(err) ? "quota" : "busy",
      );
    }
  }

  throw lastError;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts?: number;
    /** Base backoff, exposed so tests do not have to wait out real seconds. */
    baseDelayMs?: number;
    /** Called before each retry so the UI can explain the extra wait. */
    onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
  } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !isTransient(err)) throw err;

      // The provider's own hint wins; otherwise 1.5s, 4.5s, 9s.
      const base = opts.baseDelayMs ?? 1500;
      const delay =
        providerRetryHintMs(err) ?? Math.round(base * Math.pow(attempt, 1.6));

      opts.onRetry?.(attempt, delay, err);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
