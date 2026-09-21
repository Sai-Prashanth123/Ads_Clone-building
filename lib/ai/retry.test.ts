import { describe, expect, it, vi } from "vitest";
import {
  isTransient,
  providerRetryHintMs,
  withModelFallback,
  withRetry,
} from "./retry";

describe("isTransient", () => {
  it("retries provider overload and rate limits", () => {
    expect(isTransient(new Error("503 This model is currently experiencing high demand"))).toBe(true);
    expect(isTransient(new Error("429 rate limit exceeded"))).toBe(true);
    expect(isTransient(new Error("fetch failed"))).toBe(true);
  });

  it("never retries what cannot succeed", () => {
    // A zero free-tier allowance is structural, not a blip — retrying it just
    // makes the user wait longer for the same error.
    expect(isTransient(new Error("Quota exceeded, limit: 0, model: gemini-3.1-pro"))).toBe(false);
    expect(isTransient(new Error("401 invalid api key"))).toBe(false);
    expect(isTransient(new Error("404 model not found"))).toBe(false);
  });
});

describe("providerRetryHintMs", () => {
  it("reads the provider's own wait time", () => {
    expect(providerRetryHintMs(new Error("Please retry in 32.27s"))).toBe(32771);
    expect(providerRetryHintMs(new Error('retryDelay: "30s"'))).toBe(30500);
  });

  it("ignores absent or unreasonable hints", () => {
    expect(providerRetryHintMs(new Error("boom"))).toBeNull();
    // 10 minutes is not worth blocking a request on.
    expect(providerRetryHintMs(new Error("Please retry in 600s"))).toBeNull();
  });
});

describe("withRetry", () => {
  it("returns the first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withRetry(fn)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures and reports each one", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 overloaded"))
      .mockResolvedValue("ok");

    expect(await withRetry(fn, { onRetry })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("gives up immediately on a permanent failure", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("limit: 0"));
    await expect(withRetry(fn)).rejects.toThrow("limit: 0");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops after the attempt budget and rethrows the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("503 overloaded"));
    await expect(withRetry(fn, { attempts: 2 })).rejects.toThrow("overloaded");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("withModelFallback", () => {
  const models = [{ id: "model-a" }, { id: "model-b" }, { id: "model-c" }];

  it("uses the first model when it works", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withModelFallback(models, fn)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ id: "model-a" });
  });

  it("moves to the next model when one is rate-limited", async () => {
    // Free-tier quota is metered per model, so a 429 on one says nothing
    // about the next — this is what keeps a run alive instead of failing it.
    const onFallback = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 Quota exceeded, limit: 20"))
      .mockResolvedValue("ok");

    expect(await withModelFallback(models, fn, { onFallback })).toBe("ok");
    expect(fn).toHaveBeenNthCalledWith(2, { id: "model-b" });
    expect(onFallback).toHaveBeenCalledWith("model-a", "model-b");
  });

  it("does not waste the other models on a non-quota failure", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("401 invalid api key"));
    await expect(withModelFallback(models, fn)).rejects.toThrow("invalid api key");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exhausts the chain and rethrows when every model is limited", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("429 quota exceeded"));
    await expect(
      withModelFallback(models, fn, { baseDelayMs: 1 }),
    ).rejects.toThrow("quota");
    // a, b once each; c gets the in-place retries as the last resort.
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
