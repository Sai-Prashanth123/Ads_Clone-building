import { describe, expect, it } from "vitest";
import { generationMax, PLATFORMS } from "./index";
import { validateAgainstSpec } from "./validate";

const chars = (n: number) => "x".repeat(n);

describe("validateAgainstSpec — Meta", () => {
  const spec = PLATFORMS.meta;

  const valid = {
    primaryText: chars(120),
    headline: chars(38),
    description: chars(28),
  };

  it("passes copy inside every limit", () => {
    const report = validateAgainstSpec(spec, valid);
    expect(report.pass).toBe(true);
    expect(report.hasWarnings).toBe(false);
    expect(report.problems).toHaveLength(0);
  });

  it("passes a headline exactly at the recommended edge", () => {
    const report = validateAgainstSpec(spec, { ...valid, headline: chars(40) });
    expect(report.pass).toBe(true);
    expect(report.hasWarnings).toBe(false);
  });

  it("warns — but does not fail — past the truncation point", () => {
    // 41 is past `recommended` (40) but far under `max` (255). The ad runs;
    // it just gets cut off, which the user needs to know without being blocked.
    const report = validateAgainstSpec(spec, { ...valid, headline: chars(41) });
    expect(report.pass).toBe(true);
    expect(report.hasWarnings).toBe(true);
    expect(report.fields.find((f) => f.key === "headline")?.status).toBe("warn");
  });

  it("fails past the hard limit", () => {
    const report = validateAgainstSpec(spec, { ...valid, headline: chars(256) });
    expect(report.pass).toBe(false);
    expect(report.problems[0]).toContain("1 over the 255-character limit");
  });

  it("fails on an empty required field", () => {
    const report = validateAgainstSpec(spec, { ...valid, headline: "" });
    expect(report.pass).toBe(false);
    expect(report.problems[0]).toContain("is empty");
  });

  it("ignores surrounding whitespace when counting", () => {
    const report = validateAgainstSpec(spec, {
      ...valid,
      headline: `   ${chars(38)}   `,
    });
    expect(report.fields.find((f) => f.key === "headline")?.chars).toBe(38);
  });
});

describe("validateAgainstSpec — LinkedIn", () => {
  const spec = PLATFORMS.linkedin;

  it("warns on intro text past 150 without failing", () => {
    const report = validateAgainstSpec(spec, {
      introText: chars(151),
      headline: chars(60),
      cta: "Learn more",
    });
    expect(report.pass).toBe(true);
    expect(report.hasWarnings).toBe(true);
    expect(report.problems[0]).toContain("truncates");
  });

  it("fails intro text past the 600 hard limit", () => {
    const report = validateAgainstSpec(spec, {
      introText: chars(601),
      headline: chars(60),
      cta: "Learn more",
    });
    expect(report.pass).toBe(false);
  });
});

describe("validateAgainstSpec — Google repeated fields", () => {
  const spec = PLATFORMS.google;

  const base = {
    longHeadline: chars(80),
    description: chars(80),
    businessName: chars(20),
  };

  it("accepts three to five short headlines", () => {
    for (const count of [3, 4, 5]) {
      const report = validateAgainstSpec(spec, {
        ...base,
        shortHeadlines: Array.from({ length: count }, () => chars(25)),
      });
      expect(report.pass).toBe(true);
    }
  });

  it("fails when too few are supplied", () => {
    const report = validateAgainstSpec(spec, {
      ...base,
      shortHeadlines: [chars(25), chars(25)],
    });
    expect(report.pass).toBe(false);
    expect(report.problems[0]).toContain("needs 3–5");
  });

  it("fails when too many are supplied", () => {
    const report = validateAgainstSpec(spec, {
      ...base,
      shortHeadlines: Array.from({ length: 6 }, () => chars(25)),
    });
    expect(report.pass).toBe(false);
  });

  it("fails when any single entry is over length, and says how many", () => {
    const report = validateAgainstSpec(spec, {
      ...base,
      shortHeadlines: [chars(25), chars(31), chars(33)],
    });
    expect(report.pass).toBe(false);
    expect(report.problems[0]).toContain("2 of 3");
    expect(report.fields[0].entries).toHaveLength(3);
  });
});

describe("validateAgainstSpec — X", () => {
  it("warns once a post goes long-form", () => {
    const report = validateAgainstSpec(PLATFORMS.x, { text: chars(300) });
    expect(report.pass).toBe(true);
    expect(report.hasWarnings).toBe(true);
  });
});

describe("generationMax", () => {
  it("caps generation near the truncation point, not the hard limit", () => {
    // Meta primary text: 3000 hard, 125 truncation. Handing the model 3000
    // produced 891–2065 characters in a real run — the prose asking for 125
    // lost to the schema allowing 3000.
    expect(generationMax(PLATFORMS.meta.fields[0])).toBe(175);
  });

  it("leaves slack for a sentence that runs slightly over", () => {
    const headline = PLATFORMS.meta.fields[1]; // 255 hard, 40 recommended
    expect(generationMax(headline)).toBe(56);
    expect(generationMax(headline)).toBeGreaterThan(headline.recommended!);
  });

  it("never exceeds the platform's real hard limit", () => {
    for (const spec of Object.values(PLATFORMS)) {
      for (const field of spec.fields) {
        expect(generationMax(field)).toBeLessThanOrEqual(field.max);
      }
    }
  });

  it("falls back to the hard limit when a field has no truncation point", () => {
    const cta = PLATFORMS.linkedin.fields[2]; // no `recommended`
    expect(generationMax(cta)).toBe(cta.max);
  });

  it("does not change what validation reports", () => {
    // The schema steers generation; the report must still describe the
    // platform's real numbers, or the counter on the card would lie.
    const report = validateAgainstSpec(PLATFORMS.meta, {
      primaryText: "x".repeat(200),
      headline: "x".repeat(30),
      description: "x".repeat(25),
    });
    const primary = report.fields.find((f) => f.key === "primaryText")!;
    expect(primary.max).toBe(3000);
    expect(primary.recommended).toBe(125);
    expect(primary.status).toBe("warn");
  });
});
