import { detectProvider, PROVIDERS } from "./provider";

/**
 * Turn provider errors into something a user can act on.
 *
 * Provider failures are overwhelmingly configuration or quota problems, and the
 * raw text is either a stack trace or a wall of JSON. Messages name the
 * provider that actually failed — an error that blames the wrong vendor sends
 * you to the wrong dashboard, which is worse than no message at all.
 *
 * Two rules about writing the patterns, both learned the hard way:
 *
 * 1. ORDER MATTERS. Specific conditions come first. A quota error mentioning
 *    a status code must not be caught by a broader rule above it.
 *
 * 2. BARE STATUS CODES NEED WORD BOUNDARIES. `403` without \b matched inside
 *    the retry delay "40.319842403s" of a 429 quota message, so a rate limit
 *    was reported as an auth failure and sent the user to check a key that was
 *    working perfectly. Digits appear everywhere in these payloads.
 */
type Rule = {
  match: RegExp;
  /** `(label, raw)` so a message can name the live provider, or pass the
   *  original through when it already carries something actionable. */
  message: (label: string, raw: string) => string;
};

const RULES: Rule[] = [
  // Verbatim: this one carries the link that resolves it.
  { match: /credit card|payment method/i, message: (_l, raw) => raw.slice(0, 400) },
  {
    // Google reports an unfunded model as `limit: 0` rather than as billing.
    match: /limit:\s*0\b/i,
    message: (label) =>
      `${label} gives this model no free-tier quota (limit: 0), so it cannot run until billing is enabled on the project. Switching model or provider also works.`,
  },
  {
    match: /quota|resource_exhausted|\b429\b|too many requests|rate.?limit/i,
    message: (label, raw) => {
      const wait = raw.match(/retry in\s+([\d.]+)\s*s/i)?.[1];
      const seconds = wait ? Math.ceil(Number(wait)) : null;
      return seconds
        ? `${label} is rate-limited. Quota refills in about ${seconds}s — this is the free tier's per-minute cap, not a broken key.`
        : `${label} is rate-limited or out of quota. Free-tier windows refill within a minute.`;
    },
  },
  {
    match: /billing|insufficient|spend limit|\b402\b/i,
    message: (label) =>
      `${label} reports no available credit for this request. Add credit and retry.`,
  },
  {
    // Auth goes AFTER quota: a 429 body routinely contains stray digits.
    match: /api key|unauthor|credential|invalid token|permission denied|\b401\b|\b403\b/i,
    message: (label) => {
      const id = detectProvider();
      const envVar = id ? PROVIDERS[id].envVar : "your provider key";
      return `${label} rejected the request. Check ${envVar}.`;
    },
  },
  {
    match: /high demand|overloaded|unavailable|\b503\b/i,
    message: (label) =>
      `${label} is overloaded right now. Retry in a moment — this one usually clears quickly.`,
  },
  {
    match: /safety|content.?polic|moderation|blocked/i,
    message: (label) =>
      `${label} refused this prompt on content-policy grounds. Edit the prompt and retry.`,
  },
  {
    match: /not found|does not exist|\b404\b/i,
    message: (label) =>
      `${label} does not serve the configured model. It may have been renamed or retired — check lib/ai/provider.ts.`,
  },
  {
    match: /timeout|timed out|ETIMEDOUT|aborted/i,
    message: (label) =>
      `${label} took too long to respond. Try again, or use a shorter source post.`,
  },
  {
    match: /ENOTFOUND|ECONNREFUSED|fetch failed|network/i,
    message: (label) => `Couldn't reach ${label}. Check your connection and retry.`,
  },
];

/**
 * An error whose message is already written for the user. describeError passes
 * these through untouched — otherwise a carefully worded diagnostic gets
 * clobbered by a generic rule that happened to match one of its words.
 */
export class ActionableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionableError";
  }
}

export function describeError(
  err: unknown,
  /** Which service actually failed. Defaults to the analysis provider; image
   *  calls pass their own, since the two can be different services. */
  providerLabel?: string | null,
  limit = 400,
): string {
  if (err instanceof ActionableError) return err.message;

  const raw = (err instanceof Error ? err.message : String(err)).trim();

  const id = detectProvider();
  const label =
    providerLabel ?? (id ? PROVIDERS[id].label : "The model provider");

  for (const rule of RULES) {
    if (rule.match.test(raw)) return rule.message(label, raw);
  }

  return raw.slice(0, limit) || "Something went wrong.";
}
