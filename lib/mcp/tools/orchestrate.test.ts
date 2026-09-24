import { describe, expect, it } from "vitest";
import { judge, parseDraft, reviseInstructions } from "./orchestrate";
import type { AutoCloneState } from "../state";

/**
 * The loop's two failure-prone joints.
 *
 * Everything else in clone_ad_auto is protocol plumbing the SDK owns. What is
 * ours is reading a model's reply — which arrives fenced, prefaced and
 * otherwise not as instructed — and turning a measurement into an instruction
 * specific enough to act on. Both are worth holding still.
 */

const SOURCE = [
  "I audited 250 SaaS landing pages this month.",
  "",
  "71% failed in the first five seconds.",
  "",
  "- Lead with the result",
  "- Cut every adjective",
  "",
  "Full breakdown. Link below.",
].join("\n");

const state: AutoCloneState = {
  round: 1,
  platform: "meta",
  format: "carousel",
  angles: ["direct-swap"],
  source: { text: SOURCE, url: null, author: null },
};

function draft(copy: Record<string, unknown>, beats: { role: string; line: string }[] = []) {
  return {
    variations: [
      {
        angle: "direct-swap",
        copy,
        beatMapping: beats,
        imagePrompt: "p",
        visualMechanism: "m",
        imageNegatives: "n",
        altText: "a",
        rationale: "r",
      },
    ],
  };
}

describe("reading the model's reply", () => {
  const body = JSON.stringify(draft({ introText: "hello" }));

  it("reads bare JSON", () => {
    expect(parseDraft(body)?.variations).toHaveLength(1);
  });

  it("reads JSON inside a markdown fence", () => {
    expect(parseDraft("```json\n" + body + "\n```")?.variations).toHaveLength(1);
  });

  it("reads JSON after a preamble the model was told not to write", () => {
    expect(
      parseDraft("Sure! Here are the variations you asked for:\n\n" + body)
        ?.variations,
    ).toHaveLength(1);
  });

  it("returns null rather than a half-parsed draft", () => {
    expect(parseDraft("I would rather not.")).toBeNull();
    expect(parseDraft('{"variations": []}')).toBeNull();
  });
});

describe("judging a draft", () => {
  const faithful = {
    introText: [
      "We opened 300 checkout flows this week.",
      "",
      "82% dropped the buyer at step two.",
      "",
      "- Ask for the card last",
      "- Delete every optional field",
      "",
      "Teardown below.",
    ].join("\n"),
    cards: [
      { headline: "Card one", imagePrompt: "a chart" },
      { headline: "Card two", imagePrompt: "a desk" },
    ],
  };

  it("passes a rewrite that is fresh AND still the same shape", () => {
    const [v] = judge(draft(faithful, [{ role: "hook", line: "82%" }]), state);

    expect(v.failing).toEqual([]);
    expect(v.originality.pass).toBe(true);
    expect(v.fidelity.pass).toBe(true);
  });

  it("fails a draft that drifted, even though it is original", () => {
    const [v] = judge(
      draft({
        introText:
          "Have you ever wondered whether the checkout flow you inherited might be quietly costing you revenue every single day, and whether anybody on the team would even notice if it were?",
        cards: faithful.cards,
      }),
      state,
    );

    // The gap this whole guard exists for: original, but not a clone.
    expect(v.originality.pass).toBe(true);
    expect(v.failing).toContain("fidelity");
  });

  it("fails a beatMapping line that is not actually in the copy", () => {
    const [v] = judge(
      draft(faithful, [{ role: "hook", line: "A line written nowhere." }]),
      state,
    );

    expect(v.failing).toContain("beat mapping");
    expect(v.unquotedBeats).toHaveLength(1);
  });

  it("counts cards against the format, not against the platform default", () => {
    const [v] = judge(
      draft({ introText: faithful.introText, cards: [faithful.cards[0]] }),
      state,
    );

    expect(v.failing).toContain("platform spec");
    expect(v.spec.problems.join(" ")).toContain("needs 2–10");
  });
});

describe("turning a measurement into an instruction", () => {
  it("quotes the lifted phrases rather than saying 'too similar'", () => {
    const [v] = judge(draft({ introText: SOURCE, cards: [] }), state);
    const instructions = reviseInstructions([v]).join("\n");

    expect(v.originality.pass).toBe(false);
    expect(instructions).toContain("Rewrite the lines containing");
    expect(instructions).toMatch(/landing pages/);
  });

  it("says nothing about a variation that passed", () => {
    const [v] = judge(
      draft({
        introText:
          "We opened 300 checkout flows.\n\n82% lost the buyer at step two.\n\n- Card field last\n- Optional boxes go\n\nTeardown below.",
        cards: [
          { headline: "One", imagePrompt: "a" },
          { headline: "Two", imagePrompt: "b" },
        ],
      }),
      state,
    );

    expect(v.failing).toEqual([]);
    expect(reviseInstructions([v])).toEqual([]);
  });
});
