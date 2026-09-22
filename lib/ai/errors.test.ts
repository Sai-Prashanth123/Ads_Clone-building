import { describe, expect, it } from "vitest";
import { ActionableError, describeError } from "./errors";

/** The real shape Gemini returns when the per-minute free tier is exhausted. */
const QUOTA_429 = `Failed after 3 attempts. Last error: You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.
* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash
Please retry in 40.319842403s.`;

describe("describeError", () => {
  it("reads a 429 as a rate limit, not an auth failure", () => {
    // Regression: the bare `403` pattern matched inside the retry delay
    // "40.319842403s", so a working key was reported as rejected.
    const message = describeError(new Error(QUOTA_429), "Google AI Studio");
    expect(message).toContain("rate-limited");
    expect(message).not.toContain("Check GOOGLE");
    expect(message).not.toMatch(/rejected the request/);
  });

  it("surfaces the provider's own wait time when it gives one", () => {
    expect(describeError(new Error(QUOTA_429), "Google AI Studio")).toContain("41s");
  });

  it("still catches a genuine auth failure", () => {
    expect(
      describeError(new Error("401 Unauthorized: API key not valid"), "Google AI Studio"),
    ).toMatch(/rejected the request/);
    expect(
      describeError(new Error("PERMISSION_DENIED: permission denied"), "OpenAI"),
    ).toMatch(/rejected the request/);
  });

  it("distinguishes a zero free-tier allowance from a rate limit", () => {
    const message = describeError(
      new Error("Quota exceeded for metric: ..., limit: 0, model: gemini-3.1-pro"),
      "Google AI Studio",
    );
    expect(message).toContain("no free-tier quota");
    expect(message).toContain("billing is enabled");
  });

  it("names the provider that actually failed, not the analysis one", () => {
    const message = describeError(new Error("503 overloaded"), "Cloudflare Workers AI");
    expect(message).toContain("Cloudflare Workers AI");
  });

  it("passes an already-actionable message through untouched", () => {
    const written = "CLOUDFLARE_API_TOKEN is a Global API Key (cfk_), not an API Token.";
    expect(describeError(new ActionableError(written))).toBe(written);
  });

  it("does not mistake digits inside a payload for status codes", () => {
    // 401/403/404 all appear here as substrings of larger numbers.
    const noisy = new Error("Processed 1401 tokens in 2403ms across 4041 items");
    expect(describeError(noisy, "Provider")).toContain("1401 tokens");
  });
});
