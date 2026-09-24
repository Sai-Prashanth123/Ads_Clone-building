/**
 * The fidelity guard — the other half of the promise.
 *
 * lib/originality.ts measures how DIFFERENT a clone is from its source and
 * blocks anything too close. Nothing measured whether it stayed FAITHFUL, so
 * the product enforced "different words" with arithmetic and "same framework"
 * with hope. `beatMapping` looked like proof but was the model asserting it had
 * kept the structure — an assertion stored in the database and rendered as a
 * receipt.
 *
 * The two pull in opposite directions. Unrelated text scores 100% original and
 * 0% faithful; a verbatim copy is the reverse. A good clone is high on BOTH,
 * and until now nothing could tell a faithful rewrite from a clone that drifted
 * into a different ad entirely.
 *
 * Everything here is computed from the text. No model, no network — the point
 * is to measure what a model cannot assess about its own output.
 */

export type OpeningMove =
  | "question"
  | "number"
  | "negation"
  | "quote"
  | "imperative"
  | "declarative";

export type ClosingMove = "cta" | "link" | "sign-off" | "none";

export type Fingerprint = {
  /** Paragraph blocks separated by blank lines. */
  blocks: number;
  linesPerBlock: number;
  /** "-", "•", "1." or null. */
  bulletStyle: string | null;
  bulletCount: number;
  /** Mean words per bullet — fragments vs sentences. */
  bulletWords: number;
  emojiCount: number;
  /** True when an emoji sits in the first line. */
  emojiLeads: boolean;
  capsRatio: number;
  /** Digits per 100 words. A stat-led ad should stay stat-led. */
  digitDensity: number;
  hasCurrency: boolean;
  hasPercent: boolean;
  sentences: number;
  meanSentenceWords: number;
  /** Spread of sentence length — punchy one-liners vs flowing prose. */
  sentenceVariance: number;
  words: number;
  opening: OpeningMove;
  closing: ClosingMove;
};

export type DimensionMatch = {
  dimension: string;
  match: number;
  source: string | number | boolean;
  clone: string | number | boolean;
};

export type FidelityReport = {
  /** 0–100. Higher means the clone kept the original's shape. */
  score: number;
  pass: boolean;
  dimensions: DimensionMatch[];
  /** What changed, phrased so it can be acted on. */
  drifted: string[];
  sourceFingerprint: Fingerprint;
  cloneFingerprint: Fingerprint;
};

/** Below this the clone has stopped being the same ad. */
export const FIDELITY_THRESHOLD = 0.6;

export type FidelityOptions = {
  /**
   * The most list items the target format can actually carry.
   *
   * A carousel allows ten cards. Cloning a 36-item listicle into one therefore
   * loses 26 items no matter how well it is written — and scoring against 36
   * reported a drift the writer could never clear. An unclearable finding is
   * worse than none: it trains the reader to ignore the report, which is the
   * one failure a guard cannot recover from.
   *
   * So the target is the achievable count, and the drift line says the format
   * is why rather than blaming the draft. Same principle as the truncation
   * point beating length fidelity: a platform limit is not a writing mistake.
   */
  maxListItems?: number;
  /**
   * True when the target format's last slot is conventionally a CTA.
   *
   * A carousel's final card carries the button — that is the format, stated in
   * the spec's own hint. Reporting it as drift against a source that ended on a
   * sign-off pushed a rewrite toward worse copy to satisfy the measurement.
   */
  expectsTerminalCta?: boolean;
  /**
   * The list is cards or posts, not glyphs the writer chose.
   *
   * A carousel's items are discrete panels; a thread's are separate posts.
   * Flattening them for scoring has to pick some marker, and that marker is
   * ours — so comparing it against the source's "•" or "1." would report a
   * mismatch about a decision the writer never made. Count and item length stay
   * comparable, and carry the weight the style component would have had.
   */
  listIsStructural?: boolean;
  /**
   * Roughly how many words one item can hold.
   *
   * A thread post takes 280 characters and a carousel headline 45, so "pack
   * more into each item" is sound advice for one and impossible for the other.
   * Without this the guard told a carousel writer to write eighteen words into
   * a field that holds seven.
   */
  maxItemWords?: number;
};

/**
 * How far an item's length may drift before it counts as drift.
 *
 * Two answers to a format ceiling are both right. Keeping the source's item
 * rhythm is faithful; packing several of its ideas into each surviving item is
 * faithful to the CONTENT, and a format that holds twelve posts against forty
 * bullets forces one or the other. So this is a band rather than a target, and
 * anything inside it scores full marks — only an item much thinner than the
 * source's, or longer than the format can hold, is drift.
 */
function itemLengthMatch(
  sourceWords: number,
  cloneWords: number,
  packing: number,
  capacity: number | undefined,
): number {
  if (sourceWords <= 0) return ratioMatch(sourceWords, cloneWords);

  const packed = sourceWords * packing;
  const upper = Math.max(sourceWords, Math.min(packed, capacity ?? packed));

  if (cloneWords >= sourceWords && cloneWords <= upper) return 1;
  return ratioMatch(cloneWords < sourceWords ? sourceWords : upper, cloneWords);
}

/**
 * Closing moves that do the same job.
 *
 * A CTA button and a "link below" both point the reader onward; which one an ad
 * uses is decided by the platform, not the writer. Treating them as unrelated
 * made every correct LinkedIn adaptation register as drift.
 */
function closingMatch(a: ClosingMove, b: ClosingMove): number {
  if (a === b) return 1;
  const onward = (m: ClosingMove) => m === "cta" || m === "link";
  return onward(a) && onward(b) ? 0.75 : 0;
}

/** Read as a phrase, so the drift line is a sentence rather than a field dump. */
const CLOSING_PHRASE: Record<ClosingMove, string> = {
  cta: "an explicit call to action",
  link: "a pointer to a link",
  "sign-off": "a short sign-off",
  none: "no closing move",
};

const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

function detectBulletStyle(lines: string[]): { style: string | null; count: number } {
  const patterns: [string, RegExp][] = [
    ["-", /^\s*[-–—]\s+/],
    ["•", /^\s*[•·*]\s+/],
    ["1.", /^\s*\d+[.)]\s+/],
  ];

  for (const [style, re] of patterns) {
    const count = lines.filter((l) => re.test(l)).length;
    if (count >= 2) return { style, count };
  }
  return { style: null, count: 0 };
}

function detectOpening(text: string): OpeningMove {
  const first = text.trim().split("\n")[0]?.trim() ?? "";
  if (!first) return "declarative";

  if (/[?]\s*$/.test(first)) return "question";
  if (/^["“'']/.test(first)) return "quote";
  // A number anywhere in the opening line counts: "Stop wasting 4 hours" is a
  // stat-led hook even though it does not begin with the digit.
  if (/\d/.test(first)) return "number";
  if (/^(stop|don'?t|never|no more|quit|avoid)\b/i.test(first)) return "negation";
  if (/^[A-Z][a-z]+\b/.test(first) && /^(get|start|try|build|make|use|read|see|join|discover|learn|find)\b/i.test(first))
    return "imperative";

  return "declarative";
}

function detectClosing(text: string): ClosingMove {
  /* The last SENTENCE, not the last line.
   *
   * A thread post is one line of up to 280 characters, so a sign-off sitting at
   * the end of it — "…the difference is the whole pitch. let's go." — was read
   * against the whole 127-character post and came back as no closing move at
   * all. Every thread clone was then told it had dropped an ending it had
   * actually written. A short closer is its own sentence either way, so this
   * costs nothing in the single-body case.
   */
  const sentences = splitSentences(text);
  const last = sentences[sentences.length - 1]?.trim() ?? "";
  if (!last) return "none";

  /* Most social ads point at a link without pasting one: "link below", "in the
   * comments", "👇". Matching only a literal URL read all of those as no
   * closing move at all, which made the closing dimension disagree with the
   * source on ads that in fact closed identically. */
  if (
    /https?:\/\/|\blink in bio\b|\blinks? below\b|\bbelow\b|\bin the (comments|thread)\b|\bdm me\b|👇|⬇/i.test(
      last,
    )
  )
    return "link";

  /* "let's …" is the writer's own flourish, not an instruction to the reader —
   * first person plural, and a sign-off however it ends. Without this
   * "let's start." was a call to action and "let's go." a sign-off, which is a
   * distinction about the verb rather than about the copy, and it cost a writer
   * a rewrite of a line that was already right. */
  if (/^(let'?s|lets)\b/i.test(last) && last.split(/\s+/).length <= 4)
    return "sign-off";

  if (
    /\b(try|get|start|join|sign up|download|book|claim|learn more|shop|subscribe|register|apply|grab|see it|comment|reply)\b/i.test(
      last,
    )
  )
    return "cta";
  // Short closer with no verb — "let's go.", "that's it."
  if (last.split(/\s+/).length <= 4) return "sign-off";

  return "none";
}

/**
 * A line break ends a unit in ad copy.
 *
 * Joining lines before splitting on punctuation made a 36-item bullet list read
 * as ONE sentence of 225 words, because bullets rarely carry a full stop. The
 * clone's ten cards came out at 51 by the same route, so the rhythm dimension
 * was comparing two artifacts of the measurement rather than two ads — and
 * reporting drift on both. Ad copy is written in lines deliberately; that is the
 * premise the block-rhythm dimension already rests on.
 */
function splitSentences(text: string): string[] {
  return text
    .split("\n")
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    // A bullet marker is not a word.
    .map((s) => s.replace(/^\s*([-–—•·*]|\d+[.)])\s+/, "").trim())
    .filter((s) => s.split(/\s+/).filter(Boolean).length > 0);
}

export function fingerprint(text: string): Fingerprint {
  const trimmed = text.trim();
  const lines = trimmed.split("\n");
  const blocks = trimmed.split(/\n\s*\n/).filter((b) => b.trim()).length || 1;
  const nonEmpty = lines.filter((l) => l.trim());

  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length || 1;

  const { style, count } = detectBulletStyle(lines);
  const bulletLines = lines.filter((l) => /^\s*([-–—•·*]|\d+[.)])\s+/.test(l));
  const bulletWords = bulletLines.length
    ? bulletLines.reduce((sum, l) => sum + l.split(/\s+/).filter(Boolean).length, 0) /
      bulletLines.length
    : 0;

  const emojis = trimmed.match(EMOJI) ?? [];
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  const caps = trimmed.replace(/[^A-Z]/g, "");

  const sentences = splitSentences(trimmed);
  const lengths = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const mean = lengths.length
    ? lengths.reduce((a, b) => a + b, 0) / lengths.length
    : 0;
  const variance = lengths.length
    ? lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length
    : 0;

  return {
    blocks,
    linesPerBlock: Number((nonEmpty.length / blocks).toFixed(2)),
    bulletStyle: style,
    bulletCount: count,
    bulletWords: Number(bulletWords.toFixed(1)),
    emojiCount: emojis.length,
    emojiLeads: EMOJI.test(lines[0] ?? "") || /^\s*\p{Extended_Pictographic}/u.test(lines[0] ?? ""),
    capsRatio: Number((caps.length / (letters.length || 1)).toFixed(3)),
    digitDensity: Number(
      (((trimmed.match(/\d/g) ?? []).length / wordCount) * 100).toFixed(2),
    ),
    hasCurrency: /[$£€]/.test(trimmed),
    hasPercent: /%/.test(trimmed),
    sentences: sentences.length,
    meanSentenceWords: Number(mean.toFixed(1)),
    sentenceVariance: Number(variance.toFixed(1)),
    words: wordCount,
    opening: detectOpening(trimmed),
    closing: detectClosing(trimmed),
  };
}

/** 1 when identical, falling off with relative difference. */
function ratioMatch(a: number, b: number): number {
  if (a === 0 && b === 0) return 1;
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return 1;
  return Math.max(0, 1 - Math.abs(a - b) / max);
}

function exactMatch(a: unknown, b: unknown): number {
  return a === b ? 1 : 0;
}

export function checkFidelity(
  clone: string,
  original: string,
  options: FidelityOptions = {},
): FidelityReport {
  const s = fingerprint(original);
  const c = fingerprint(clone);

  // What the format allows, not what the source had.
  const targetItems =
    options.maxListItems != null && s.bulletCount > 0
      ? Math.min(s.bulletCount, options.maxListItems)
      : s.bulletCount;

  const cappedByFormat = targetItems < s.bulletCount;

  /* A capped list has to pack more into each item.
   *
   * Forty source bullets into twelve thread posts is three or four ideas a
   * post, so each post is necessarily several times longer than the bullet it
   * descends from. Comparing item length to the source's then charges the
   * writer for the ceiling twice — once on the count, which is already
   * forgiven, and again on the length, which was not. The expected length
   * scales with how hard the format makes you pack. */
  const packing = cappedByFormat ? s.bulletCount / targetItems : 1;

  const itemWordsMatch = itemLengthMatch(
    s.bulletWords,
    c.bulletWords,
    packing,
    options.maxItemWords,
  );

  // Weighted because these are not equally diagnostic. The opening move and
  // the list shape are what make an ad recognisably the same ad; block counts
  // drift harmlessly.
  const dims: (DimensionMatch & { weight: number })[] = [
    {
      dimension: "opening move",
      match: exactMatch(s.opening, c.opening),
      source: s.opening,
      clone: c.opening,
      weight: 0.2,
    },
    {
      dimension: "closing move",
      // A format whose last slot IS a button cannot be marked down for having
      // one. That is the platform's choice, not the writer's.
      match:
        options.expectsTerminalCta && c.closing === "cta"
          ? 1
          : closingMatch(s.closing, c.closing),
      source: s.closing,
      clone: c.closing,
      weight: 0.1,
    },
    {
      dimension: "list shape",
      match: options.listIsStructural
        ? ratioMatch(targetItems, c.bulletCount) * 0.6 + itemWordsMatch * 0.4
        : exactMatch(s.bulletStyle, c.bulletStyle) * 0.5 +
          ratioMatch(targetItems, c.bulletCount) * 0.3 +
          itemWordsMatch * 0.2,
      source: s.bulletStyle
        ? `${s.bulletStyle} ×${s.bulletCount}${
            cappedByFormat ? ` (format allows ${targetItems})` : ""
          }`
        : "none",
      clone: c.bulletStyle ? `${c.bulletStyle} ×${c.bulletCount}` : "none",
      weight: 0.2,
    },
    {
      dimension: "sentence rhythm",
      /* Packing lengthens the sentences too.
       *
       * Three of the source's one-line bullets in a single thread post is one
       * longer sentence, so charging the rhythm dimension for it is the same
       * ceiling billed a third time — after the count and the item length. The
       * same band applies: the source's own rhythm and the packed rhythm are
       * both faithful answers, and only drifting past either end is drift. */
      match:
        itemLengthMatch(
          s.meanSentenceWords,
          c.meanSentenceWords,
          packing,
          options.maxItemWords,
        ) *
          0.6 +
        ratioMatch(s.sentenceVariance, c.sentenceVariance) * 0.4,
      source: `${s.meanSentenceWords}w mean`,
      clone: `${c.meanSentenceWords}w mean`,
      weight: 0.15,
    },
    {
      dimension: "block rhythm",
      match: ratioMatch(s.blocks, c.blocks) * 0.5 + ratioMatch(s.linesPerBlock, c.linesPerBlock) * 0.5,
      source: `${s.blocks} blocks`,
      clone: `${c.blocks} blocks`,
      weight: 0.1,
    },
    {
      dimension: "emphasis",
      match:
        ratioMatch(s.emojiCount, c.emojiCount) * 0.5 +
        ratioMatch(s.capsRatio, c.capsRatio) * 0.5,
      source: `${s.emojiCount} emoji`,
      clone: `${c.emojiCount} emoji`,
      weight: 0.1,
    },
    {
      dimension: "stat density",
      match:
        ratioMatch(s.digitDensity, c.digitDensity) * 0.6 +
        exactMatch(s.hasCurrency, c.hasCurrency) * 0.2 +
        exactMatch(s.hasPercent, c.hasPercent) * 0.2,
      source: `${s.digitDensity}/100w`,
      clone: `${c.digitDensity}/100w`,
      weight: 0.15,
    },
  ];

  const score = dims.reduce((sum, d) => sum + d.match * d.weight, 0);

  const drifted: string[] = [];

  if (s.opening !== c.opening) {
    drifted.push(
      `The original opens with a ${s.opening} hook; yours opens ${c.opening}. That is the part that stops the scroll — match it.`,
    );
  }
  if (s.bulletStyle && !c.bulletStyle) {
    drifted.push(
      `The original is a ${s.bulletStyle} list of ${s.bulletCount} items; yours has no list. The scannable shape is doing the work.`,
    );
  }
  /* Say plainly when the format is the constraint.
   *
   * Without this the report reads as a failure to fix, and there is nothing to
   * fix — the writer is already at the ceiling. */
  if (cappedByFormat && c.bulletCount >= targetItems) {
    drifted.push(
      `The original lists ${s.bulletCount} items and this format holds ${targetItems}. You are at the ceiling, so the remaining gap is the format's cost, not a fault in the draft — pick the strongest ${targetItems}, or pack about ${Math.round(packing * 10) / 10} of the original's ideas into each.`,
    );
  }
  if (!s.bulletStyle && c.bulletStyle && !options.listIsStructural) {
    drifted.push(
      "The original is prose; yours is a bulleted list. That changes how it reads in feed.",
    );
  }
  // Only when the gap is the draft's doing. Saying "yours lists 10" directly
  // after "you are at the ceiling" contradicted the line above it.
  if (
    s.bulletStyle &&
    c.bulletStyle &&
    !cappedByFormat &&
    ratioMatch(targetItems, c.bulletCount) < 0.5
  ) {
    drifted.push(
      `The original lists ${s.bulletCount} items; yours lists ${c.bulletCount}.`,
    );
  }
  if (
    itemLengthMatch(
      s.meanSentenceWords,
      c.meanSentenceWords,
      packing,
      options.maxItemWords,
    ) < 0.5
  ) {
    drifted.push(
      `Sentence length drifted: ${s.meanSentenceWords} words on average versus your ${c.meanSentenceWords}. Punchy copy must stay punchy.`,
    );
  }
  if (s.digitDensity > 2 && c.digitDensity < s.digitDensity / 2) {
    drifted.push(
      "The original leans on specific numbers and yours does not. Concrete figures are load-bearing here.",
    );
  }
  if (s.emojiCount > 0 && c.emojiCount === 0) {
    drifted.push("The original uses emoji and yours uses none.");
  }
  // Only a real change of move is drift — swapping a link for a button is not,
  // and neither is a terminal CTA the format requires.
  const closingIsFine =
    (options.expectsTerminalCta && c.closing === "cta") ||
    closingMatch(s.closing, c.closing) >= 0.75;

  if (!closingIsFine) {
    drifted.push(
      `The original ends on ${CLOSING_PHRASE[s.closing]}; yours ends on ${CLOSING_PHRASE[c.closing]}.`,
    );
  }

  return {
    score: Math.round(score * 100),
    pass: score >= FIDELITY_THRESHOLD,
    // Weights are an internal detail of the score; the caller gets the match.
    dimensions: dims.map((d) => ({
      dimension: d.dimension,
      match: Number(d.match.toFixed(3)),
      source: d.source,
      clone: d.clone,
    })),
    drifted,
    sourceFingerprint: s,
    cloneFingerprint: c,
  };
}

/* ------------------------------------------------------------------ *
 * beatMapping, verified rather than trusted
 * ------------------------------------------------------------------ */

export type BeatCheck = {
  pass: boolean;
  /** Claimed lines that do not appear in the clone at all. */
  missing: string[];
  /** True when the claimed roles follow the source's beat order. */
  orderMatches: boolean;
  problems: string[];
};

function normaliseLine(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
}

/**
 * The model claims each line serves a beat. Check that the lines are actually
 * in the clone and that the roles run in the source's order — otherwise the
 * "receipt" is just a second piece of generated text.
 */
export function verifyBeatMapping(
  cloneText: string,
  mapping: { role: string; line: string }[],
  sourceBeatRoles: string[],
): BeatCheck {
  const haystack = normaliseLine(cloneText);

  const missing = mapping
    .filter((m) => {
      const needle = normaliseLine(m.line);
      return needle.length > 0 && !haystack.includes(needle);
    })
    .map((m) => m.line);

  // Every claimed role, in claimed order, must be a subsequence of the
  // source's beat order.
  const claimed = mapping.map((m) => m.role);
  let cursor = 0;
  let orderMatches = true;
  for (const role of claimed) {
    const at = sourceBeatRoles.indexOf(role, cursor);
    if (at === -1) {
      orderMatches = false;
      break;
    }
    cursor = at + 1;
  }

  const problems: string[] = [];
  if (missing.length) {
    problems.push(
      `${missing.length} mapped line${missing.length === 1 ? "" : "s"} do not appear in the copy — the mapping describes text that was not written.`,
    );
  }
  if (!orderMatches) {
    problems.push(
      `The beat order does not follow the original (${sourceBeatRoles.join(" > ")}).`,
    );
  }

  return { pass: problems.length === 0, missing, orderMatches, problems };
}
