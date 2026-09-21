import { describe, expect, it, vi } from "vitest";
import {
  bucketFor,
  resetBuckets,
  TokenBucket,
  withRateLimit,
} from "./limiter";

/** A clock the test drives, so a 60-second window costs no real time. */
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("TokenBucket", () => {
  it("allows a full window's worth immediately", () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 20, windowMs: 60_000, now: clock.now });

    for (let i = 0; i < 20; i++) expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it("reports how long until the next token, rather than just refusing", () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 20, windowMs: 60_000, now: clock.now });

    for (let i = 0; i < 20; i++) bucket.tryTake();

    // One of twenty per minute back = 3 seconds.
    expect(bucket.msUntilToken()).toBe(3000);
  });

  it("refills continuously, not in one jump on the minute", () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 20, windowMs: 60_000, now: clock.now });

    for (let i = 0; i < 20; i++) bucket.tryTake();
    expect(bucket.tryTake()).toBe(false);

    clock.advance(15_000); // a quarter of the window
    expect(bucket.available).toBe(5);
    for (let i = 0; i < 5; i++) expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it("never exceeds capacity however long it idles", () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 20, windowMs: 60_000, now: clock.now });

    bucket.tryTake();
    clock.advance(10 * 60_000);
    expect(bucket.available).toBe(20);
  });

  it("paces 25 calls against a 20/min bucket instead of firing them", () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 20, windowMs: 60_000, now: clock.now });

    let allowed = 0;
    let refused = 0;
    for (let i = 0; i < 25; i++) {
      if (bucket.tryTake()) allowed++;
      else refused++;
    }

    // The five past the limit are held back rather than sent to be rejected.
    expect(allowed).toBe(20);
    expect(refused).toBe(5);
  });
});

describe("withRateLimit", () => {
  it("runs immediately when quota is free", async () => {
    resetBuckets();
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withRateLimit("model-a", fn)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns null rather than blocking when the wait exceeds the budget", async () => {
    resetBuckets();
    const bucket = bucketFor("model-b", 2);
    bucket.tryTake();
    bucket.tryTake();

    const fn = vi.fn();
    // maxWaitMs defaults to 0: with somewhere else to go, waiting is the
    // wrong call, so the caller is told to route elsewhere.
    expect(await withRateLimit("model-b", fn)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("waits and then runs when the budget allows it", async () => {
    resetBuckets();
    const bucket = bucketFor("model-c", 60); // one per second
    for (let i = 0; i < 60; i++) bucket.tryTake();

    const onWait = vi.fn();
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await withRateLimit("model-c", fn, {
      rpm: 60,
      maxWaitMs: 5_000,
      onWait,
    });

    expect(result).toBe("ok");
    expect(onWait).toHaveBeenCalled();
  }, 10_000);

  it("keeps separate budgets per model", async () => {
    resetBuckets();
    const a = bucketFor("model-d", 1);
    a.tryTake();

    // A exhausted says nothing about B — that is the whole reason the
    // fallback chain works on a free tier.
    expect(await withRateLimit("model-d", async () => "a")).toBeNull();
    expect(await withRateLimit("model-e", async () => "b")).toBe("b");
  });
});
