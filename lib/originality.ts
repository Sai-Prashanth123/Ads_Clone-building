/**
 * The originality guard.
 *
 * "Same framework, different words" is the whole product promise, so it is
 * enforced here in plain deterministic code rather than left to the model's
 * good intentions. No AI calls — this must be cheap, repeatable and testable.
 *
 * Three independent signals, because each one alone is easy to game:
 *   1. n-gram overlap      — catches wholesale paraphrase
 *   2. longest shared run   — catches a single lifted sentence in otherwise
 *                             fresh copy, which (1) would dilute to nothing
 *   3. rare-word overlap    — catches lifted distinctive vocabulary (product
 *                             names, coined phrases, unusual metaphors) even
 *                             when the sentences around them were rewritten
 */

export type OriginalityReport = {
  /** 0–100. Higher is more original. */
  score: number;
  pass: boolean;
  ngramOverlap: number;
  longestSharedRun: number;
  rareWordOverlap: number;
  /** Verbatim runs to feed back to the model on a retry. */
  sharedPhrases: string[];
  reasons: string[];
};

export const THRESHOLDS = {
  /** Jaccard over word 5-grams. */
  ngramOverlap: 0.18,
  /** Any shared run this long is a lift, however low the other numbers. */
  longestSharedRun: 6,
  /** Share of the original's distinctive vocabulary that reappears. */
  rareWordOverlap: 0.35,
} as const;

const NGRAM_N = 5;

const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been
  before being below between both but by can cannot could did do does doing down
  during each few for from further had has have having he her here hers herself
  him himself his how i if in into is it its itself just me more most my myself
  no nor not now of off on once only or other our ours ourselves out over own
  same she should so some such than that the their theirs them themselves then
  there these they this those through to too under until up very was we were
  what when where which while who whom why will with you your yours yourself
  yourselves it's don't won't you're we're they're i'm that's what's here's
  there's let's get got make makes made use uses used using one two three`
    .split(/\s+/)
    .filter(Boolean),
);

/** Lowercase, strip emoji/punctuation/URLs, collapse whitespace. */
export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/['’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function ngrams(words: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) {
    out.add(words.slice(i, i + n).join(" "));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Longest run of consecutive words appearing in both, via the classic
 * dynamic-programming longest-common-substring over word arrays.
 */
function longestCommonRun(
  a: string[],
  b: string[],
): { length: number; phrase: string } {
  if (!a.length || !b.length) return { length: 0, phrase: "" };

  let best = 0;
  let bestEndA = 0;
  // Rolling two rows — the full matrix is needless for long-form posts.
  let prev = new Uint32Array(b.length + 1);
  let curr = new Uint32Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > best) {
          best = curr[j];
          bestEndA = i;
        }
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return {
    length: best,
    phrase: best ? a.slice(bestEndA - best, bestEndA).join(" ") : "",
  };
}

/** Every shared run at or above `min` words, longest first, de-duplicated. */
function sharedRuns(a: string[], b: string[], min: number): string[] {
  const bGrams = ngrams(b, min);
  const found: string[] = [];

  for (let i = 0; i + min <= a.length; i++) {
    if (!bGrams.has(a.slice(i, i + min).join(" "))) continue;
    // Extend greedily so we report the whole lifted phrase, not a window of it.
    let end = i + min;
    while (
      end < a.length &&
      b.join(" ").includes(a.slice(i, end + 1).join(" "))
    ) {
      end++;
    }
    found.push(a.slice(i, end).join(" "));
    i = end - 1;
  }

  return [...new Set(found)].sort((x, y) => y.length - x.length).slice(0, 8);
}

function rareWords(words: string[]): Set<string> {
  return new Set(
    words.filter((w) => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w)),
  );
}

export function checkOriginality(
  candidate: string,
  original: string,
): OriginalityReport {
  const a = normalize(candidate);
  const b = normalize(original);

  const ngramOverlap = jaccard(ngrams(a, NGRAM_N), ngrams(b, NGRAM_N));
  const { length: longestSharedRun } = longestCommonRun(a, b);

  const rareA = rareWords(a);
  const rareB = rareWords(b);
  let rareShared = 0;
  for (const w of rareB) if (rareA.has(w)) rareShared++;
  const rareWordOverlap = rareB.size ? rareShared / rareB.size : 0;

  const reasons: string[] = [];
  if (ngramOverlap > THRESHOLDS.ngramOverlap) {
    reasons.push(
      `Phrasing overlaps the original too heavily (${(ngramOverlap * 100).toFixed(1)}% of 5-word sequences shared).`,
    );
  }
  if (longestSharedRun >= THRESHOLDS.longestSharedRun) {
    reasons.push(
      `Lifts a ${longestSharedRun}-word run verbatim from the original.`,
    );
  }
  if (rareWordOverlap > THRESHOLDS.rareWordOverlap) {
    reasons.push(
      `Reuses ${(rareWordOverlap * 100).toFixed(0)}% of the original's distinctive vocabulary.`,
    );
  }

  // Each signal contributes to the score; the run penalty is steepest because
  // a lifted sentence is the failure mode with actual legal teeth.
  const ngramPenalty = Math.min(1, ngramOverlap / (THRESHOLDS.ngramOverlap * 2));
  const runPenalty = Math.min(1, longestSharedRun / (THRESHOLDS.longestSharedRun * 1.5));
  const rarePenalty = Math.min(1, rareWordOverlap / (THRESHOLDS.rareWordOverlap * 2));
  const penalty = 0.34 * ngramPenalty + 0.46 * runPenalty + 0.2 * rarePenalty;

  return {
    score: Math.round(Math.max(0, 1 - penalty) * 100),
    pass: reasons.length === 0,
    ngramOverlap: Number(ngramOverlap.toFixed(4)),
    longestSharedRun,
    rareWordOverlap: Number(rareWordOverlap.toFixed(4)),
    sharedPhrases: sharedRuns(a, b, Math.min(4, THRESHOLDS.longestSharedRun)),
    reasons,
  };
}

/* ------------------------------------------------------------------ *
 * Convergence — candidates against each other
 * ------------------------------------------------------------------ */

export type ConvergencePair = {
  a: string;
  b: string;
  overlap: number;
  longestSharedRun: number;
  sharedPhrases: string[];
};

export type ConvergenceReport = {
  /** True when no pair is too similar to another. */
  pass: boolean;
  /** Worst overlap found, 0–1. */
  worst: number;
  pairs: ConvergencePair[];
};

/**
 * Two variations can each be perfectly original against the SOURCE and still be
 * near-copies of each other. At batch scale that is the dominant failure mode:
 * fifty clones converging on the same phrasing, every one of them passing the
 * source check.
 *
 * Same maths as checkOriginality — it is a text-similarity problem either way,
 * and a second algorithm would be a second thing to keep correct. The threshold
 * is looser than the source one: variations of a single ad SHOULD share a
 * subject and a structure. What they must not share is wording.
 */
export const CONVERGENCE_THRESHOLDS = {
  ngramOverlap: 0.25,
  longestSharedRun: 7,
} as const;

export function checkConvergence(
  items: { id: string; text: string }[],
): ConvergenceReport {
  const pairs: ConvergencePair[] = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const report = checkOriginality(items[i].text, items[j].text);
      const tooClose =
        report.ngramOverlap > CONVERGENCE_THRESHOLDS.ngramOverlap ||
        report.longestSharedRun >= CONVERGENCE_THRESHOLDS.longestSharedRun;

      if (tooClose) {
        pairs.push({
          a: items[i].id,
          b: items[j].id,
          overlap: report.ngramOverlap,
          longestSharedRun: report.longestSharedRun,
          sharedPhrases: report.sharedPhrases.slice(0, 4),
        });
      }
    }
  }

  return {
    pass: pairs.length === 0,
    worst: pairs.reduce((max, p) => Math.max(max, p.overlap), 0),
    pairs: pairs.sort((a, b) => b.overlap - a.overlap),
  };
}
