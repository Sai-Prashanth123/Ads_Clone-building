import { describe, expect, it } from "vitest";
import { checkOriginality, normalize, THRESHOLDS } from "./originality";

const ORIGINAL = `Stop wasting 4 hours a day on manual data entry.

Our AI tool automates your spreadsheets in 1 click. 👇

Here is how it works:
- Connect your source
- Pick a template
- Watch the rows fill themselves

Try it free for 14 days.`;

describe("normalize", () => {
  it("strips urls, emoji and punctuation", () => {
    expect(normalize("Hey! 👇 visit https://x.com/a now.")).toEqual([
      "hey",
      "visit",
      "now",
    ]);
  });
});

describe("checkOriginality", () => {
  it("flags a near-verbatim copy", () => {
    const plagiarised = `Stop wasting 4 hours a day on manual data entry.

Our AI tool automates your spreadsheets in 1 click. 👇

Here is how it works:
- Connect your source
- Pick a template
- Watch the rows fill themselves

Start your free trial today.`;

    const report = checkOriginality(plagiarised, ORIGINAL);
    expect(report.pass).toBe(false);
    expect(report.score).toBeLessThan(40);
    expect(report.longestSharedRun).toBeGreaterThanOrEqual(
      THRESHOLDS.longestSharedRun,
    );
    expect(report.sharedPhrases.length).toBeGreaterThan(0);
  });

  it("flags a light paraphrase that keeps distinctive vocabulary", () => {
    const paraphrase = `Stop wasting 4 hours each day on manual data entry.
Our AI tool automates the spreadsheets in a single click.
Here is how it works — connect your source, pick a template, watch rows fill.`;

    expect(checkOriginality(paraphrase, ORIGINAL).pass).toBe(false);
  });

  it("passes a genuine rewrite that keeps only the framework", () => {
    const rewrite = `Still losing half your workday to tedious typing?

Let automation handle your rows and columns instantly. 🚀

Three steps to a clean sheet:
- Link whichever system holds your records
- Choose a layout
- Let the cells populate on their own

First fortnight costs nothing.`;

    const report = checkOriginality(rewrite, ORIGINAL);
    expect(report.pass).toBe(true);
    expect(report.score).toBeGreaterThan(60);
    expect(report.reasons).toHaveLength(0);
  });

  it("catches one lifted sentence buried in otherwise fresh copy", () => {
    const mostlyFresh = `Your afternoon disappears into a keyboard, one cell at a time.

There is a faster route. Our AI tool automates your spreadsheets in 1 click.

Reclaim the afternoon — the first fortnight is on us, no card needed.`;

    const report = checkOriginality(mostlyFresh, ORIGINAL);
    expect(report.pass).toBe(false);
    // Dilution means the n-gram signal alone would have missed this.
    expect(report.ngramOverlap).toBeLessThan(THRESHOLDS.ngramOverlap);
    expect(report.longestSharedRun).toBeGreaterThanOrEqual(
      THRESHOLDS.longestSharedRun,
    );
  });

  it("treats unrelated copy as fully original", () => {
    const unrelated =
      "We roast single-origin beans in small batches and ship them the same morning.";
    const report = checkOriginality(unrelated, ORIGINAL);
    expect(report.pass).toBe(true);
    expect(report.score).toBeGreaterThan(90);
  });

  it("handles empty input without throwing", () => {
    expect(() => checkOriginality("", ORIGINAL)).not.toThrow();
    expect(checkOriginality("", ORIGINAL).score).toBeGreaterThan(90);
  });
});
