import { describe, expect, it } from "vitest";
import { checkFidelity, fingerprint, verifyBeatMapping } from "./fidelity";
import { checkOriginality } from "./originality";

const ORIGINAL = `Stop wasting 4 hours a day on manual data entry.

Our AI tool automates your spreadsheets in 1 click. 👇

- Connect your source
- Pick a template
- Watch the rows fill themselves

Try it free for 14 days.`;

/** Same machine, different words — what a good clone looks like. */
const FAITHFUL = `Still losing half your workday to tedious typing?

Automation handles your rows and columns in 2 seconds. 🚀

- Link whichever system holds your records
- Choose a layout
- Let the cells populate on their own

Start your 30-day trial today.`;

/** Passes originality easily, but is not the same ad at all. */
const DRIFTED = `We roast single-origin beans in small batches.

Every bag is shipped the morning after roasting, which means the coffee
reaching your kitchen is fresher than anything a supermarket shelf can
offer, and our subscribers tell us the difference is unmistakable.`;

describe("fingerprint", () => {
  it("reads the structural shape of an ad", () => {
    const f = fingerprint(ORIGINAL);
    expect(f.opening).toBe("number");
    expect(f.bulletStyle).toBe("-");
    expect(f.bulletCount).toBe(3);
    expect(f.emojiCount).toBeGreaterThan(0);
    expect(f.closing).toBe("cta");
  });

  it("classifies opening moves", () => {
    expect(fingerprint("Why is your CAC rising?").opening).toBe("question");
    expect(fingerprint("Stop guessing at pricing.").opening).toBe("negation");
    expect(fingerprint('"We tripled revenue" — a real customer').opening).toBe("quote");
    expect(fingerprint("Our platform helps teams ship.").opening).toBe("declarative");
  });

  it("does not throw on empty or whitespace input", () => {
    expect(() => fingerprint("")).not.toThrow();
    expect(() => fingerprint("   \n  ")).not.toThrow();
  });

  /* Most social ads point at a link without pasting one. Reading "Link below."
   * as no closing move made the closing dimension disagree with the source on
   * ads that in fact ended the same way — a false drift report, which is worse
   * than none, because it sends the model to rewrite something that was right. */
  it("recognises a link closer that contains no link", () => {
    expect(fingerprint("Full breakdown, no email needed. Link below.").closing).toBe(
      "link",
    );
    expect(fingerprint("Details in the comments.").closing).toBe("link");
    expect(fingerprint("The whole teardown is at https://example.com/x").closing).toBe(
      "link",
    );
  });

  it("classifies the other closing moves", () => {
    expect(fingerprint("The teardown is free. Grab it here.").closing).toBe("cta");
    expect(fingerprint("Drop a comment and I will send it.").closing).toBe("cta");
    expect(fingerprint("That is it.").closing).toBe("sign-off");
    expect(
      fingerprint("We rebuilt ours and conversions doubled the following quarter.")
        .closing,
    ).toBe("none");
  });
});

describe("checkFidelity", () => {
  it("passes a faithful rewrite", () => {
    const report = checkFidelity(FAITHFUL, ORIGINAL);
    expect(report.pass).toBe(true);
    expect(report.score).toBeGreaterThan(70);
  });

  it("catches drift that the originality guard waves through", () => {
    // THE case nothing caught before this guard existed. Unrelated copy is
    // maximally "original" — and not a clone of anything.
    expect(checkOriginality(DRIFTED, ORIGINAL).pass).toBe(true);

    const report = checkFidelity(DRIFTED, ORIGINAL);
    expect(report.pass).toBe(false);
    expect(report.drifted.length).toBeGreaterThan(0);
  });

  it("scores a verbatim copy as maximally faithful", () => {
    // Fidelity and originality are opposite axes: this passes one and fails
    // the other, which is why both verdicts have to be read together.
    const report = checkFidelity(ORIGINAL, ORIGINAL);
    expect(report.score).toBe(100);
    expect(checkOriginality(ORIGINAL, ORIGINAL).pass).toBe(false);
  });

  it("names the drift specifically enough to act on", () => {
    const prose = `Why does data entry still take so long?

Our platform removes the manual work entirely and gives your team back
the better part of every afternoon.`;

    const report = checkFidelity(prose, ORIGINAL);
    expect(report.drifted.join(" ")).toMatch(/list/i);
    expect(report.drifted.join(" ")).toMatch(/opens/i);
  });

  it("flags a lost list even when the words are fine", () => {
    const noList = `Stop wasting 4 hours a day on data entry.

Connect a source, pick a template, and the rows fill themselves.

Try it free for 14 days.`;

    const report = checkFidelity(noList, ORIGINAL);
    expect(report.dimensions.find((d) => d.dimension === "list shape")!.match)
      .toBeLessThan(0.6);
  });

  it("notices when specific numbers disappear", () => {
    const vague = `Stop wasting most of your day on manual data entry.

Our AI tool automates your spreadsheets instantly. 👇

- Connect your source
- Pick a template
- Watch the rows fill themselves

Try it free for a couple of weeks.`;

    const report = checkFidelity(vague, ORIGINAL);
    expect(report.drifted.join(" ")).toMatch(/numbers/i);
  });
});

describe("verifyBeatMapping", () => {
  const beats = ["hook", "mechanism", "cta"];

  it("accepts a mapping whose lines really are in the copy", () => {
    const result = verifyBeatMapping(
      FAITHFUL,
      [
        { role: "hook", line: "Still losing half your workday to tedious typing?" },
        { role: "cta", line: "Start your 30-day trial today." },
      ],
      beats,
    );
    expect(result.pass).toBe(true);
  });

  it("catches a mapping that describes text never written", () => {
    // The failure the old self-reported receipt could not detect.
    const result = verifyBeatMapping(
      FAITHFUL,
      [{ role: "hook", line: "A line that appears nowhere in the ad" }],
      beats,
    );
    expect(result.pass).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.problems[0]).toMatch(/do not appear/);
  });

  it("catches beats claimed out of the original's order", () => {
    const result = verifyBeatMapping(
      FAITHFUL,
      [
        { role: "cta", line: "Start your 30-day trial today." },
        { role: "hook", line: "Still losing half your workday to tedious typing?" },
      ],
      beats,
    );
    expect(result.orderMatches).toBe(false);
    expect(result.pass).toBe(false);
  });

  it("ignores punctuation and casing when matching lines", () => {
    const result = verifyBeatMapping(
      FAITHFUL,
      [{ role: "hook", line: "still losing half your workday to tedious typing" }],
      beats,
    );
    expect(result.pass).toBe(true);
  });
});

describe("closing-move equivalence", () => {
  /* A CTA button and a "link below" are the same move in different platform
   * vocabularies. Scoring them as unrelated reported drift on the single most
   * common correct adaptation there is, which trains the reader to ignore the
   * report — the one failure a guard cannot recover from. */
  const SOURCE = [
    "I audited 250 landing pages.",
    "",
    "71% failed in five seconds.",
    "",
    "- Lead with the result",
    "- Cut every adjective",
    "",
    "Full breakdown. Link below.",
  ].join("\n");

  const withButton = [
    "We opened 300 checkout flows.",
    "",
    "82% lost the buyer at step two.",
    "",
    "- Ask for the card last",
    "- Delete optional fields",
    "",
    "Learn more",
  ].join("\n");

  const withSignOff = [
    "We opened 300 checkout flows.",
    "",
    "82% lost the buyer at step two.",
    "",
    "- Ask for the card last",
    "- Delete optional fields",
    "",
    "Anyway.",
  ].join("\n");

  it("does not report drift when a link becomes a CTA button", () => {
    const report = checkFidelity(withButton, SOURCE);

    expect(report.drifted.join(" ")).not.toContain("ends on");
    expect(report.pass).toBe(true);
  });

  it("still reports drift when the ad stops pointing anywhere", () => {
    const report = checkFidelity(withSignOff, SOURCE);

    expect(report.drifted.join(" ")).toContain("ends on");
  });
});

describe("what the target format makes impossible", () => {
  /* A carousel holds ten cards. Cloning a 36-item listicle into one loses 26
   * items however well it is written, and scoring against 36 reported a drift
   * the writer could never clear. An unclearable finding is worse than none:
   * it teaches the reader to ignore the report. */
  const longList = [
    "36 ways to compete with a giant:",
    "",
    ...Array.from({ length: 36 }, (_, i) => `- Tactic number ${i + 1} goes here`),
    "",
    "Link below.",
  ].join("\n");

  const tenCards = [
    "10 moves for a small team against an incumbent:",
    "",
    ...Array.from({ length: 10 }, (_, i) => `- Fresh move ${i + 1} written anew`),
    "",
    "Details in the comments.",
  ].join("\n");

  it("penalises a ten-item clone when nothing said the format caps it", () => {
    const uncapped = checkFidelity(tenCards, longList);
    const listShape = uncapped.dimensions.find((d) => d.dimension === "list shape")!;

    expect(listShape.match).toBeLessThan(0.85);
  });

  it("stops penalising it once the ceiling is known", () => {
    const capped = checkFidelity(tenCards, longList, { maxListItems: 10 });
    const listShape = capped.dimensions.find((d) => d.dimension === "list shape")!;

    expect(listShape.match).toBeGreaterThan(0.95);
    expect(capped.score).toBeGreaterThan(checkFidelity(tenCards, longList).score);
  });

  it("says the format is the constraint rather than blaming the draft", () => {
    const capped = checkFidelity(tenCards, longList, { maxListItems: 10 });
    const notes = capped.drifted.join(" ");

    expect(notes).toContain("this format holds 10");
    expect(notes).toContain("not a fault in the draft");
  });

  it("still penalises a clone that is short of the achievable ceiling", () => {
    const threeCards = [
      "3 moves for a small team:",
      "",
      "- Fresh move one written anew",
      "- Fresh move two written anew",
      "- Fresh move three written anew",
      "",
      "Details in the comments.",
    ].join("\n");

    const capped = checkFidelity(threeCards, longList, { maxListItems: 10 });
    const listShape = capped.dimensions.find((d) => d.dimension === "list shape")!;

    // Ten were available and three were written — that IS the draft's doing.
    expect(listShape.match).toBeLessThan(0.85);
    expect(capped.drifted.join(" ")).not.toContain("not a fault in the draft");
  });

  /* The carousel's last card carries the button — the format says so in its own
   * hint. Marking it as drift against a source that ended on a sign-off pushed
   * a rewrite toward worse copy to satisfy the measurement. */
  it("accepts a terminal CTA when the format requires one", () => {
    const endsOnSignOff = "We shipped 3 features.\n\n- One\n- Two\n\nAnyway.";
    const endsOnCta = "We shipped 9 features.\n\n- Alpha\n- Beta\n\nLearn more";

    expect(checkFidelity(endsOnCta, endsOnSignOff).drifted.join(" ")).toContain(
      "ends on",
    );

    expect(
      checkFidelity(endsOnCta, endsOnSignOff, { expectsTerminalCta: true }).drifted.join(
        " ",
      ),
    ).not.toContain("ends on");
  });
});

describe("sentence rhythm in list-heavy copy", () => {
  /* Bullets rarely carry a full stop. Joining the lines before splitting on
   * punctuation made a 36-item list read as ONE sentence of 225 words, so the
   * rhythm dimension compared two artifacts of the measurement rather than two
   * ads — and reported drift on both. */
  const listicle = [
    "36 ways to compete with a giant:",
    "",
    ...Array.from({ length: 36 }, (_, i) => `- Tactic number ${i + 1} here`),
    "",
    "Link below.",
  ].join("\n");

  it("counts each line as its own unit", () => {
    const f = fingerprint(listicle);

    expect(f.sentences).toBe(38);
    expect(f.meanSentenceWords).toBeLessThan(10);
  });

  it("does not count the bullet marker as a word", () => {
    const withMarkers = fingerprint("- one two three\n- four five six");
    const without = fingerprint("one two three\nfour five six");

    expect(withMarkers.meanSentenceWords).toBe(without.meanSentenceWords);
  });

  it("still splits prose on punctuation", () => {
    const f = fingerprint("First sentence here. Second one follows. Third ends it.");
    expect(f.sentences).toBe(3);
  });

  it("does not report rhythm drift between two list-shaped ads", () => {
    const shorter = [
      "10 moves for a small team:",
      "",
      ...Array.from({ length: 10 }, (_, i) => `- Fresh angle ${i + 1} anew`),
      "",
      "Details in the comments.",
    ].join("\n");

    const report = checkFidelity(shorter, listicle, { maxListItems: 10 });
    expect(report.drifted.join(" ")).not.toContain("Sentence length drifted");
  });
});

describe("the drift notes do not contradict each other", () => {
  it("says the ceiling OR the shortfall, never both", () => {
    const source = [
      "36 ways:",
      "",
      ...Array.from({ length: 36 }, (_, i) => `- Item ${i + 1} written out`),
    ].join("\n");

    const atCeiling = [
      "10 ways:",
      "",
      ...Array.from({ length: 10 }, (_, i) => `- Fresh ${i + 1} written out`),
    ].join("\n");

    const notes = checkFidelity(atCeiling, source, { maxListItems: 10 }).drifted.join(" ");

    expect(notes).toContain("You are at the ceiling");
    expect(notes).not.toContain("yours lists 10");
  });
});

describe("a closing move buried in a long block", () => {
  /* A thread post is one line of up to 280 characters. Reading the closing move
   * from the last LINE meant a sign-off at the end of the final post was
   * measured against the whole post and came back as none — so every thread
   * clone was told it had dropped an ending it had actually written. */
  it("reads the last sentence, not the last line", () => {
    const post =
      "Answer every support message inside an hour. Their queue is measured in days and the difference is the whole pitch. let's go.";

    expect(fingerprint(post).closing).toBe("sign-off");
  });

  it("still reads a short closer on its own line", () => {
    expect(fingerprint("We shipped it.\n\nLink below.").closing).toBe("link");
    expect(fingerprint("We shipped it.\n\nLearn more").closing).toBe("cta");
  });

  it("reports none when the copy genuinely just stops", () => {
    expect(
      fingerprint(
        "We rebuilt the onboarding flow and conversions climbed the following quarter across every segment.",
      ).closing,
    ).toBe("none");
  });
});

describe("a sign-off is not a call to action", () => {
  /* "let's start." read as a CTA while "let's go." read as a sign-off, because
   * `start` is in the verb list and `go` is not. That is a distinction about
   * the verb rather than about the copy, and it cost a writer a rewrite of a
   * line that was already right. */
  it("reads let's-anything as the writer's own flourish", () => {
    for (const closer of ["let's start.", "let's go.", "let's roll.", "lets build."]) {
      expect(fingerprint(closer).closing, closer).toBe("sign-off");
    }
  });

  it("still reads an instruction to the reader as a CTA", () => {
    expect(fingerprint("Grab it here.").closing).toBe("cta");
    expect(fingerprint("Start your free trial today.").closing).toBe("cta");
  });

  it("does not swallow a long sentence that merely opens with let's", () => {
    expect(
      fingerprint("Let's be honest about what this costs before you commit to it.")
        .closing,
    ).toBe("none");
  });
});
