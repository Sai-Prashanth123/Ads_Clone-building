import { describe, expect, it } from "vitest";
import { NoObjectGeneratedError } from "ai";
import { describeOverlong, findOverlong, overlongNotes } from "./overlong";
import { getFormat, getPlatform } from "../platforms";

/**
 * This reads text a model produced and a schema already rejected — so it is
 * parsing something known to be wrong, in unknown ways. Every case here is a
 * shape it has to survive without throwing, because throwing would replace a
 * bad error message with a worse one.
 */

/**
 * The rejection the AI SDK throws, with only the parts that matter here.
 *
 * Its constructor also wants response metadata and a full token breakdown; none
 * of that is read, so restating it would be a fixture pretending to be a
 * fidelity to the real thing that it is not.
 */
function rejection(text: string) {
  return new NoObjectGeneratedError({
    message: "No object generated: response did not match schema.",
    text,
    finishReason: "stop",
  } as unknown as ConstructorParameters<typeof NoObjectGeneratedError>[0]);
}

const linkedin = getPlatform("linkedin");

describe("finding the field that overran", () => {
  it("names the field, the angle and the overrun", () => {
    const found = findOverlong(
      rejection(
        JSON.stringify({
          variations: [
            { angle: "direct-swap", copy: { introText: "x".repeat(260), headline: "ok" } },
          ],
        }),
      ),
      linkedin,
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      angle: "direct-swap",
      field: "introText",
      chars: 260,
      limit: 210,
    });
  });

  it("reaches inside carousel cards", () => {
    const found = findOverlong(
      rejection(
        JSON.stringify({
          variations: [
            {
              angle: "aggressive",
              copy: {
                introText: "fine",
                cards: [
                  { headline: "fine", imagePrompt: "p" },
                  { headline: "y".repeat(60), imagePrompt: "p" },
                ],
              },
            },
          ],
        }),
      ),
      getFormat("linkedin", "carousel"),
    );

    expect(found).toHaveLength(1);
    expect(found[0].label).toBe("Card headline");
    expect(found[0].chars).toBe(60);
  });

  it("checks every entry of a repeated field", () => {
    const found = findOverlong(
      rejection(
        JSON.stringify({
          variations: [
            {
              angle: "direct-swap",
              copy: {
                shortHeadlines: ["fine", "z".repeat(40), "w".repeat(45)],
                longHeadline: "fine",
                description: "fine",
                businessName: "fine",
              },
            },
          ],
        }),
      ),
      getPlatform("google"),
    );

    expect(found).toHaveLength(2);
    expect(found.map((f) => f.chars)).toEqual([40, 45]);
  });

  it("says nothing when the rejection was not an overrun", () => {
    // A missing field, a bad enum — real rejections that this must not
    // misreport as a length problem.
    expect(
      findOverlong(
        rejection(JSON.stringify({ variations: [{ angle: "direct-swap", copy: {} }] })),
        linkedin,
      ),
    ).toEqual([]);
  });

  it("survives text that is not JSON at all", () => {
    expect(findOverlong(rejection("I'd rather not, sorry."), linkedin)).toEqual([]);
    expect(findOverlong(rejection('{"variations": [{"angle": "trunc'), linkedin)).toEqual(
      [],
    );
    expect(findOverlong(rejection("null"), linkedin)).toEqual([]);
    expect(findOverlong(rejection('{"variations": "nope"}'), linkedin)).toEqual([]);
  });

  it("is not confused by an unrelated error", () => {
    expect(findOverlong(new Error("network down"), linkedin)).toEqual([]);
    expect(findOverlong(undefined, linkedin)).toEqual([]);
  });
});

describe("saying what to do about it", () => {
  const found = findOverlong(
    rejection(
      JSON.stringify({
        variations: [
          { angle: "direct-swap", copy: { introText: "x".repeat(260) } },
          { angle: "minimalist", copy: { introText: "x".repeat(215) } },
        ],
      }),
    ),
    linkedin,
  );

  it("tells the model to cut rather than reword", () => {
    const notes = overlongNotes(found);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain("50 over");
    expect(notes[0]).toContain("Cut it");
  });

  it("gives the operator the worst case, not a list", () => {
    const line = describeOverlong(found);
    expect(line).toContain("2 field limits");
    expect(line).toContain("260");
  });

  it("returns nothing to say when nothing overran", () => {
    expect(describeOverlong([])).toBe("");
  });
});
