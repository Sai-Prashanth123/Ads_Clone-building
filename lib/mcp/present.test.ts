import { describe, expect, it } from "vitest";
import { presentSwipe } from "./present";
import type { SavedSwipe } from "../db/swipes";

/**
 * A finished run came back as a table of scores with the ads nowhere in it,
 * because the tool returned a database row as JSON and a host handed a large
 * JSON object summarises it. These hold the opposite: the copy is the answer.
 */

const clone = (over: Record<string, unknown> = {}) =>
  ({
    id: "c1",
    angle: "direct-swap",
    body: "flattened fallback copy",
    rationale: "leads with the audit number",
    image_prompt: "a dark forum post, charcoal and teal",
    image_url: null,
    image_model: null,
    alt_text: null,
    originality: { score: 85, pass: true },
    fidelity: { score: 83, pass: true, drifted: [] },
    regenerated: false,
    target_format: "thread",
    fields: null,
    beat_mapping: null,
    ...over,
  }) as SavedSwipe["clones"][number];

const swipe = (over: Record<string, unknown> = {}): SavedSwipe =>
  ({
    id: "s1",
    created_at: "2026-09-24T00:00:00Z",
    source_url: "https://x.com/a/status/1",
    author_handle: "gregisenberg",
    author_name: "Greg",
    original_text: "36 ways to compete:\n\n- one\n- two",
    original_media_url: null,
    engagement: { likes: 4961 },
    dna: {} as SavedSwipe["dna"],
    hook_type: "listicle-promise",
    platform: "x",
    target_format: "thread",
    clones: [clone()],
    ...over,
  }) as SavedSwipe;

describe("presenting a saved run", () => {
  it("leads with the copy, not the scores", () => {
    const out = presentSwipe(
      swipe({
        clones: [
          clone({
            fields: {
              hookPost: "36 ways a one-room gym beats a chain:",
              posts: [{ text: "- price the outcome" }, { text: "- answer in an hour" }],
            },
          }),
        ],
      }),
    );

    expect(out).toContain("36 ways a one-room gym beats a chain:");
    expect(out).toContain("price the outcome");
    expect(out).toContain("answer in an hour");
  });

  it("renders the platform-shaped fields rather than the flattened fallback", () => {
    const out = presentSwipe(
      swipe({
        clones: [
          clone({
            fields: { hookPost: "the real hook", posts: [{ text: "- the real post" }] },
          }),
        ],
      }),
    );

    expect(out).toContain("the real hook");
    expect(out).not.toContain("flattened fallback copy");
  });

  it("falls back to the stored body for a run saved before formats existed", () => {
    const out = presentSwipe(swipe({ clones: [clone({ fields: null })] }));
    expect(out).toContain("flattened fallback copy");
  });

  it("carries the scores without making them the headline", () => {
    const out = presentSwipe(swipe());

    expect(out).toContain("originality 85");
    expect(out).toContain("fidelity 83");
    // The angle heading comes before any number.
    expect(out.indexOf("direct-swap")).toBeLessThan(out.indexOf("originality 85"));
  });

  it("says where the creative is, or that there is only a prompt", () => {
    expect(presentSwipe(swipe())).toContain("Creative: not rendered");
    expect(
      presentSwipe(
        swipe({ clones: [clone({ image_url: "https://store.test/a.png" })] }),
      ),
    ).toContain("attached below");
  });

  it("marks a draft that was rewritten after a flag", () => {
    expect(presentSwipe(swipe({ clones: [clone({ regenerated: true })] }))).toContain(
      "rewritten after a flag",
    );
  });

  it("includes the source so the clone can be judged against it", () => {
    expect(presentSwipe(swipe())).toContain("36 ways to compete:");
  });
});
