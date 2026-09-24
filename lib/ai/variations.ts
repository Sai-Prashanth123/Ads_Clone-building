import { generateObject } from "ai";
import { getAnalysisModels, type NamedModel } from "./provider";
import {
  DEFAULT_ANGLES,
  buildVariationsSchema,
  type Angle,
  type AdDna,
  type BrandProfile,
  type CopyFields,
  type Variation,
} from "./schemas";
import { VARIATIONS_SYSTEM, variationsPrompt } from "./prompts";
import {
  checkConvergence,
  checkOriginality,
  type ConvergenceReport,
  type OriginalityReport,
} from "../originality";
import { withModelFallback } from "./retry";
import type { SourcePost } from "../x/types";
import {
  fidelityOptionsFor,
  fieldsToText,
  PLATFORMS,
  type PlatformSpec,
} from "../platforms";
import { validateAgainstSpec, type SpecReport } from "../platforms/validate";
import { checkFidelity, type FidelityReport } from "../fidelity";
import { describeOverlong, findOverlong, overlongNotes } from "./overlong";
import { ActionableError } from "./errors";

export type ScoredVariation = Variation & {
  originality: OriginalityReport;
  /** Per-field character check against the target platform's published spec. */
  spec: SpecReport;
  /** The other axis: did the rewrite keep the original's shape? */
  fidelity: FidelityReport;
  /** Set only when this variation is too close to another in the same run. */
  convergence?: ConvergenceReport;
  /** True when this text is the product of an enforced rewrite. */
  regenerated: boolean;
};

type RawVariation = {
  angle: string;
  copy: CopyFields;
  beatMapping: { role: string; line: string }[];
  imagePrompt: string;
  visualMechanism: string;
  imageNegatives: string;
  altText: string;
  rationale: string;
};

/**
 * Flatten platform-shaped copy back into the single `text` the originality
 * guard and the library expect, while keeping the structured fields alongside
 * it. Nothing downstream had to change because of this.
 */
function normalise(
  raw: RawVariation,
  platform: PlatformSpec,
  sourceText: string,
): ScoredVariation {
  const text = fieldsToText(platform, raw.copy);

  return {
    ...(raw as unknown as Variation),
    text,
    fields: raw.copy,
    originality: checkOriginality(text, sourceText),
    // Originality alone cannot tell a faithful rewrite from a draft that
    // wandered off into a different ad. This is the second half of the claim.
    fidelity: checkFidelity(text, sourceText, fidelityOptionsFor(platform)),
    spec: validateAgainstSpec(platform, raw.copy),
    regenerated: false,
  };
}

/**
 * Flag variations that are near-copies of EACH OTHER.
 *
 * A set can pass the source check unanimously and still be three paraphrases
 * of one idea — which is the failure mode that actually wastes a batch. Run
 * once over the final set, so it reflects whatever the retry settled on.
 */
function withConvergence(items: ScoredVariation[]): ScoredVariation[] {
  const report = checkConvergence(
    items.map((v) => ({ id: v.angle, text: v.text })),
  );

  if (report.pass) return items;

  const involved = new Set(report.pairs.flatMap((p) => [p.a, p.b]));
  return items.map((v) =>
    involved.has(v.angle) ? { ...v, convergence: report } : v,
  );
}

/**
 * Generate the angles, then hold them to BOTH halves of the contract.
 *
 * The guards are the point, and they pull in opposite directions. A model told
 * "don't plagiarise" drifts toward the source's phrasing; a model told "don't
 * reuse a phrase" drifts away from its shape and returns a good ad that is not
 * a clone of this one. Either failure earns one rewrite with the specific
 * measurement quoted — lifted phrases as exclusions, lost structure as targets.
 * What the user sees is a passing variant or an honest badge saying it did not
 * get there.
 */
export type VariationProgress =
  | { phase: "drafting" }
  | { phase: "checking" }
  | {
      phase: "rewriting";
      failing: number;
      phrases: string[];
      /** What structure was lost, when that is why the rewrite is happening. */
      drift?: string[];
    }
  | { phase: "note"; message: string };

export async function generateVariations(args: {
  post: SourcePost;
  dna: AdDna;
  brand?: BrandProfile | null;
  /** Which platform's field structure and limits to write for. */
  platform?: PlatformSpec;
  /** Which angles to produce. Defaults to the classic three. */
  selectedAngles?: Angle[];
  /** Injectable so the retry/scoring logic can be tested without a provider. */
  models?: NamedModel[];
  /** The retry doubles the wait, so the UI has to be told it is happening. */
  onProgress?: (progress: VariationProgress) => void;
}): Promise<ScoredVariation[]> {
  const {
    post,
    dna,
    brand,
    platform = PLATFORMS.x,
    selectedAngles = DEFAULT_ANGLES,
    models = getAnalysisModels(),
    onProgress,
  } = args;

  // The schema carries the platform's real fields and limits, so the model
  // writes LinkedIn copy rather than a blob someone later has to reshape.
  const schema = buildVariationsSchema(platform, selectedAngles.length);

  const notify = {
    onRetry: (attempt: number, delayMs: number) =>
      onProgress?.({
        phase: "note" as const,
        message: `Provider was busy — waiting ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1})`,
      }),
    onFallback: (from: string, to: string, reason: "quota" | "busy") =>
      onProgress?.({
        phase: "note" as const,
        message: `${from} is ${reason === "quota" ? "rate-limited" : "busy"} — switching to ${to}`,
      }),
  };

  const draft = (extra?: { forbiddenPhrases?: string[]; driftNotes?: string[] }) =>
    withModelFallback(
      models,
      ({ model }) =>
        generateObject({
          model,
          schema,
          system: VARIATIONS_SYSTEM,
          prompt: variationsPrompt({
            post,
            dna,
            brand,
            platform,
            selectedAngles,
            ...extra,
          }),
        }),
      notify,
    );

  onProgress?.({ phase: "drafting" });

  /* A field over its cap rejects the whole batch.
   *
   * That is the schema doing its job — the cap is what stops a 3,000-character
   * allowance being filled — but "response did not match schema" ends the run
   * with nothing to act on, which is the one thing every other guard here
   * refuses to do. So the rejected text is measured, and the model is asked
   * again with the overrun quoted. Only a genuinely unreadable reply aborts. */
  let first;
  try {
    first = await draft();
  } catch (err) {
    const overlong = findOverlong(err, platform);
    if (overlong.length === 0) throw err;

    onProgress?.({
      phase: "note",
      message: `${describeOverlong(overlong)} Asking again.`,
    });

    try {
      first = await draft({ driftNotes: overlongNotes(overlong) });
    } catch (retryErr) {
      const still = findOverlong(retryErr, platform);
      throw still.length
        ? new ActionableError(
            `${describeOverlong(still)} It did the same on the retry — the source may be too long to compress into this platform's fields. Try a platform with more room, or shorten the source.`,
          )
        : retryErr;
    }
  }

  const scored: ScoredVariation[] = first.object.variations.map((v) =>
    normalise(v as RawVariation, platform, post.text),
  );

  onProgress?.({ phase: "checking" });

  const failing = scored.filter((v) => !v.originality.pass || !v.fidelity.pass);
  if (failing.length === 0) return withConvergence(scored);

  // One retry, with the offending phrases named. Cheaper and more reliable
  // than looping — if the second pass still fails, the UI says so plainly
  // rather than silently shipping near-copy.
  const forbiddenPhrases = [
    ...new Set(
      failing
        .filter((v) => !v.originality.pass)
        .flatMap((v) => v.originality.sharedPhrases),
    ),
  ].slice(0, 12);

  const driftNotes = [
    ...new Set(
      failing.filter((v) => !v.fidelity.pass).flatMap((v) => v.fidelity.drifted),
    ),
  ].slice(0, 8);

  onProgress?.({
    phase: "rewriting",
    failing: failing.length,
    phrases: forbiddenPhrases.slice(0, 4),
    drift: driftNotes.slice(0, 3),
  });

  try {
    // The rewrite keeps whatever the first pass produced if it fails for any
    // reason — including an overrun — so no recovery is needed here.
    const retry = await draft({ forbiddenPhrases, driftNotes });

    const retried = new Map(
      retry.object.variations.map((v) => {
        const n = normalise(v as RawVariation, platform, post.text);
        return [n.angle, n] as const;
      }),
    );

    /* Keep whichever attempt is better, per angle.
     *
     * "Better" is the pair, not either score alone: a rewrite that recovers the
     * source's structure by borrowing its wording is worse than the draft it
     * replaced, and scoring on originality alone would have promoted it. A draft
     * that passes both always beats one that does not, whatever the totals. */
    const rank = (v: ScoredVariation) => {
      const passes = Number(v.originality.pass) + Number(v.fidelity.pass);
      return passes * 1000 + v.originality.score + v.fidelity.score;
    };

    const resolved = scored.map((original) => {
      const candidate = retried.get(original.angle);
      if (!candidate) return original;
      if (rank(candidate) <= rank(original)) return original;
      return { ...candidate, regenerated: true };
    });

    return withConvergence(resolved);
  } catch {
    return withConvergence(scored);
  }
}
