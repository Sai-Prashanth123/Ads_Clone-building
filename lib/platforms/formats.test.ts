import { describe, expect, it } from "vitest";
import {
  allFormats,
  aspectDimensions,
  ASPECT_RATIOS,
  fidelityOptionsFor,
  fieldsToText,
  getFormat,
  PLATFORMS,
} from "./index";
import { buildVariationSchema } from "../ai/schemas";
import { validateAgainstSpec } from "./validate";
import { checkFidelity } from "../fidelity";
import { checkOriginality } from "../originality";

/**
 * The formats that carry most paid spend — carousels, threads, RSAs — could not
 * be expressed at all before groups existed. These tests hold the three places
 * a group has to be understood in the same way: the schema the model fills, the
 * validator, and the flattening the guards score.
 */

describe("the format registry", () => {
  it("registers every format under its platform", () => {
    const ids = allFormats().map(({ platform, format }) => `${platform}/${format.id}`);

    expect(ids).toEqual([
      "x/post",
      "x/thread",
      "linkedin/single-image",
      "linkedin/carousel",
      "meta/feed",
      "meta/carousel",
      "meta/story",
      "google/display",
      "google/search",
    ]);
  });

  it("falls back to the default format rather than throwing", () => {
    expect(getFormat("meta", "nope").id).toBe("feed");
    expect(getFormat("meta").id).toBe("feed");
    expect(getFormat(null).id).toBe("post");
  });

  it("keeps each platform's default format mirrored on the platform", () => {
    for (const spec of Object.values(PLATFORMS)) {
      expect(spec.fields).toBe(spec.formats[0].fields);
      expect(spec.defaultAspect).toBe(spec.formats[0].defaultAspect);
    }
  });
});

describe("group generation schemas", () => {
  it("emits cards as an array of records, not numbered keys", () => {
    const schema = buildVariationSchema(getFormat("linkedin", "carousel"));

    const result = schema.safeParse({
      angle: "direct-swap",
      copy: {
        introText: "Five things nobody tells you about pipeline reviews.",
        cards: [
          { headline: "One: the forecast is a story", imagePrompt: "chart" },
          { headline: "Two: the story has an author", imagePrompt: "desk" },
        ],
      },
      beatMapping: [{ role: "hook", line: "Five things" }],
      imagePrompt: "p",
      visualMechanism: "m",
      imageNegatives: "n",
      altText: "a",
      rationale: "r",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a carousel with one card", () => {
    const schema = buildVariationSchema(getFormat("meta", "carousel"));

    const result = schema.safeParse({
      angle: "direct-swap",
      copy: {
        introText: "intro",
        cards: [{ headline: "only one", imagePrompt: "p" }],
      },
      beatMapping: [{ role: "hook", line: "intro" }],
      imagePrompt: "p",
      visualMechanism: "m",
      imageNegatives: "n",
      altText: "a",
      rationale: "r",
    });

    expect(result.success).toBe(false);
  });

  it("caps an RSA at 15 headlines", () => {
    const schema = buildVariationSchema(getFormat("google", "search"));
    const base = {
      angle: "direct-swap" as const,
      beatMapping: [{ role: "hook" as const, line: "h" }],
      imagePrompt: "p",
      visualMechanism: "m",
      imageNegatives: "n",
      altText: "a",
      rationale: "r",
    };

    const copy = (n: number) => ({
      headlines: Array.from({ length: n }, (_, i) => `Headline ${i + 1}`),
      descriptions: ["One description here", "Another description here"],
      displayPath: "pricing",
    });

    expect(schema.safeParse({ ...base, copy: copy(15) }).success).toBe(true);
    expect(schema.safeParse({ ...base, copy: copy(16) }).success).toBe(false);
    expect(schema.safeParse({ ...base, copy: copy(2) }).success).toBe(false);
  });
});

describe("flattening for the guards", () => {
  const carousel = () =>
    fieldsToText(getFormat("linkedin", "carousel"), {
      introText: "Intro line.",
      cards: [
        { headline: "First card", imagePrompt: "a dark forum post, charcoal" },
        { headline: "Second card", imagePrompt: "a desk" },
      ],
    });

  it("includes card copy, so a carousel is scored on what the reader reads", () => {
    const text = carousel();

    expect(text).toContain("Intro line.");
    expect(text).toContain("First card");
    expect(text).toContain("Second card");
  });

  /* Cards ARE the list. Rendered as bare lines they carried no list signal, so
   * ten carousel cards scored zero on list shape against a bulleted source —
   * the scannable shape was in the ad and missing from the measured text. */
  it("renders cards as a list, because that is what a reader sees", () => {
    expect(carousel()).toContain("- First card");
    expect(carousel()).toContain("- Second card");
  });

  /* An imagePrompt is a brief for an image model. Scored, it inflated the
   * sentence length, fed image vocabulary into the originality check, and as
   * the last line made the closing move read from a prompt, not the CTA card. */
  it("leaves image prompts out entirely", () => {
    const text = carousel();

    expect(text).not.toContain("dark forum post");
    expect(text).not.toContain("charcoal");
    expect(text).not.toContain("a desk");
  });

  it("flattens a thread in post order", () => {
    const text = fieldsToText(getFormat("x", "thread"), {
      hookPost: "Here is the thread.",
      posts: [{ text: "alpha" }, { text: "beta" }, { text: "gamma" }],
    });

    expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("beta"));
    expect(text.indexOf("beta")).toBeLessThan(text.indexOf("gamma"));
  });

  it("names the offending card by position", () => {
    const report = validateAgainstSpec(getFormat("linkedin", "carousel"), {
      introText: "Intro.",
      cards: [
        { headline: "Fine", imagePrompt: "p" },
        { headline: "x".repeat(60), imagePrompt: "p" },
      ],
    });

    expect(report.pass).toBe(false);
    expect(report.problems.join(" ")).toContain("Card 2 · Card headline");
  });
});

describe("renderable aspect ratios", () => {
  /* Two endpoints used to keep their own hardcoded copy of this list, and both
   * had drifted: the MCP tool refused 9:16 so a Meta story could not render at
   * its own ratio, and the web route refused 1.91:1 — the default for LinkedIn
   * AND Google. Deriving it means adding a format is enough. */
  it("covers every ratio any format asks for", () => {
    for (const { platform, format } of allFormats()) {
      for (const ratio of format.aspectRatios) {
        expect(
          ASPECT_RATIOS,
          `${platform}/${format.id} wants ${ratio}`,
        ).toContain(ratio);
      }
      expect(ASPECT_RATIOS).toContain(format.defaultAspect);
    }
  });

  it("includes the two that were missing", () => {
    expect(ASPECT_RATIOS).toContain("9:16");
    expect(ASPECT_RATIOS).toContain("1.91:1");
  });

  it("gives every ratio real pixel dimensions", () => {
    for (const ratio of ASPECT_RATIOS) {
      const { width, height } = aspectDimensions(ratio);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
    }
  });

  /* 1.91:1 silently rendered as 16:9 for a while because the dimension table
   * had no case for it and fell through to the default. Distinct ratios must
   * produce distinct frames, or the fallback hides the omission. */
  it("does not collapse distinct ratios onto one frame", () => {
    const shapes = ASPECT_RATIOS.map((r) => {
      const { width, height } = aspectDimensions(r);
      return `${width}x${height}`;
    });

    expect(new Set(shapes).size).toBe(ASPECT_RATIOS.length);
  });
});

describe("what each format tells the fidelity guard", () => {
  it("gives a carousel its card ceiling and its terminal CTA", () => {
    const o = fidelityOptionsFor(getFormat("linkedin", "carousel"));
    expect(o.maxListItems).toBe(10);
    expect(o.expectsTerminalCta).toBe(true);
  });

  it("gives a thread its post ceiling and no CTA expectation", () => {
    const o = fidelityOptionsFor(getFormat("x", "thread"));
    expect(o.maxListItems).toBe(12);
    expect(o.expectsTerminalCta).toBeUndefined();
  });

  it("reads a repeated field's ceiling when there is no group", () => {
    // Google's RSA repeats one field 15 times rather than grouping records.
    expect(fidelityOptionsFor(getFormat("google", "search")).maxListItems).toBe(15);
  });

  it("caps nothing for a single free-form body", () => {
    expect(fidelityOptionsFor(getFormat("x", "post")).maxListItems).toBeUndefined();
  });
});

describe("a carousel can actually pass fidelity now", () => {
  /* The whole chain, end to end: a 36-item listicle cloned into ten cards.
   *
   * Every link had to be right for this to pass, and each was broken in a
   * different way — the cards carried no list signal, the image prompts were
   * being counted as copy, the 36-item target was unreachable, and the CTA card
   * read as a change of closing move. */
  const source = [
    "36 ways to compete with a giant:",
    "",
    ...Array.from({ length: 36 }, (_, i) => `- Tactic number ${i + 1} goes here`),
    "",
    "Link below.",
  ].join("\n");

  const spec = getFormat("linkedin", "carousel");

  const fields = {
    introText: "10 moves a small team can use against an incumbent:",
    cards: [
      ...Array.from({ length: 9 }, (_, i) => ({
        headline: `Fresh angle ${i + 1} written anew`,
        imagePrompt: "a dark forum post, charcoal and teal, screenshot texture",
      })),
      { headline: "Learn more", imagePrompt: "a dark forum post, charcoal" },
    ],
  };

  it("passes both guards", () => {
    const text = fieldsToText(spec, fields);
    const report = checkFidelity(text, source, fidelityOptionsFor(spec));

    expect(checkOriginality(text, source).pass).toBe(true);
    expect(report.pass).toBe(true);
  });

  it("reports the format's cost without blaming the draft", () => {
    const text = fieldsToText(spec, fields);
    const report = checkFidelity(text, source, fidelityOptionsFor(spec));

    expect(report.drifted.join(" ")).toContain("not a fault in the draft");
    // The CTA card is the format's convention, not a change of move.
    expect(report.drifted.join(" ")).not.toContain("ends on");
  });
});
