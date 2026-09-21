import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { generateVariations } from "./variations";
import type { AdDna } from "./schemas";
import type { SourcePost } from "../x/types";

/**
 * Covers the riskiest logic in the pipeline — the originality retry — without
 * touching a provider. What matters here is that a near-copy is caught, sent
 * back, and replaced only when the second attempt is genuinely better.
 */

const ORIGINAL_TEXT = `Stop wasting 4 hours a day on manual data entry.

Our AI tool automates your spreadsheets in 1 click.

Try it free for 14 days.`;

const post: SourcePost = {
  id: "1",
  url: "https://x.com/acme/status/1",
  author: { name: "Acme", handle: "acme" },
  text: ORIGINAL_TEXT,
  media: [],
  engagement: { likes: 1000 },
  source: "fxtwitter",
};

const dna: AdDna = {
  hook: {
    type: "pain-point",
    verbatimOpening: "Stop wasting 4 hours a day on manual data entry.",
    whyItStops: "Names a concrete daily cost.",
  },
  structure: {
    beats: [
      { role: "hook", purpose: "name the pain", lineCount: 1 },
      { role: "mechanism", purpose: "show the fix", lineCount: 1 },
      { role: "cta", purpose: "remove risk", lineCount: 1 },
    ],
  },
  formatting: {
    emojiUse: "none",
    lineBreakPattern: "blank line between each",
    capsUse: "sentence case",
    listStyle: "none",
    approxLength: ORIGINAL_TEXT.length,
  },
  audience: {
    who: "ops managers",
    painState: "drowning in manual work",
    desiredOutcome: "time back",
    sophisticationLevel: "problem-aware",
  },
  persuasion: {
    triggers: ["loss aversion"],
    objectionsHandled: ["cost"],
    proofType: "specific number",
  },
  cta: { style: "free trial", verbatim: "Try it free for 14 days." },
  visual: null,
  whyItWorks: ["Quantifies the pain", "One clear mechanism", "Risk-free ask"],
};

/** Near-verbatim — must be caught by the guard. */
const PLAGIARISED = `Stop wasting 4 hours a day on manual data entry.

Our AI tool automates your spreadsheets in 1 click.

Start today.`;

/** Genuinely rewritten — must pass. */
const CLEAN = `Still losing half your workday to tedious typing?

Let automation handle rows and columns the moment they land.

First fortnight costs nothing.`;

function variationsPayload(text: string) {
  return {
    variations: (["direct-swap", "aggressive", "minimalist"] as const).map(
      (angle) => ({
        angle,
        text,
        beatMapping: [{ role: "hook" as const, line: text.split("\n")[0] }],
        imagePrompt: "A wide teal desk scene rendered as flat vector art.",
        imageNegatives: "photorealism, clutter",
        altText: "Desk scene",
        visualMechanism: "keeps the one-vs-many contrast that carried the joke",
        rationale: "Keeps the beats, changes the surface.",
      }),
    ),
  };
}

/** A mock that returns a different payload on each successive call. */
function sequencedModel(payloads: object[]) {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const payload = payloads[Math.min(call, payloads.length - 1)];
      call++;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: {
            total: 10,
            noCache: 10,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

describe("generateVariations", () => {
  it("passes clean copy through without a retry", async () => {
    const result = await generateVariations({
      post,
      dna,
      models: [{ id: "mock", model: sequencedModel([variationsPayload(CLEAN)]) }],
    });

    expect(result).toHaveLength(3);
    expect(result.every((v) => v.originality.pass)).toBe(true);
    expect(result.every((v) => v.regenerated === false)).toBe(true);
  });

  it("retries plagiarised copy and adopts the cleaner rewrite", async () => {
    const result = await generateVariations({
      post,
      dna,
      models: [{ id: "mock", model: sequencedModel([
        variationsPayload(PLAGIARISED),
        variationsPayload(CLEAN),
      ]) }],
    });

    expect(result).toHaveLength(3);
    expect(result.every((v) => v.regenerated)).toBe(true);
    expect(result.every((v) => v.originality.pass)).toBe(true);
    expect(result.every((v) => v.text === CLEAN)).toBe(true);
  });

  it("keeps the first attempt when the retry is no better", async () => {
    // Both attempts are near-copies; the retry must not be forced in, and the
    // failure must remain visible rather than being silently accepted.
    const result = await generateVariations({
      post,
      dna,
      models: [{ id: "mock", model: sequencedModel([variationsPayload(PLAGIARISED)]) }],
    });

    expect(result.every((v) => v.originality.pass)).toBe(false);
    expect(result.every((v) => v.regenerated === false)).toBe(true);
  });

  it("survives a retry that throws, keeping the first attempt", async () => {
    let call = 0;
    const flaky = new MockLanguageModelV4({
      doGenerate: async () => {
        call++;
        if (call > 1) throw new Error("provider exploded");
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(variationsPayload(PLAGIARISED)) },
          ],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: {
            inputTokens: {
              total: 10,
              noCache: 10,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });

    const result = await generateVariations({ post, dna, models: [{ id: "mock", model: flaky }] });
    expect(result).toHaveLength(3);
    expect(result.every((v) => v.originality.pass)).toBe(false);
  });
});
