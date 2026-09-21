import { generateObject } from "ai";
import { getAnalysisModels, type NamedModel } from "./provider";
import {
  variationsSchema,
  type AdDna,
  type BrandProfile,
  type Variation,
} from "./schemas";
import { VARIATIONS_SYSTEM, variationsPrompt } from "./prompts";
import { checkOriginality, type OriginalityReport } from "../originality";
import { withModelFallback } from "./retry";
import type { SourcePost } from "../x/types";

export type ScoredVariation = Variation & {
  originality: OriginalityReport;
  /** True when this text is the product of an enforced rewrite. */
  regenerated: boolean;
};

/**
 * Generate the three angles, then hold them to the originality contract.
 *
 * The guard is the point: a model told "don't plagiarise" will still drift
 * toward the source's phrasing, so anything that fails is sent back once with
 * its own lifted phrases quoted as exclusions. What the user sees is either a
 * passing variant or an honest badge saying it didn't get there.
 */
export type VariationProgress =
  | { phase: "drafting" }
  | { phase: "checking" }
  | { phase: "rewriting"; failing: number; phrases: string[] }
  | { phase: "note"; message: string };

export async function generateVariations(args: {
  post: SourcePost;
  dna: AdDna;
  brand?: BrandProfile | null;
  /** Injectable so the retry/scoring logic can be tested without a provider. */
  models?: NamedModel[];
  /** The retry doubles the wait, so the UI has to be told it is happening. */
  onProgress?: (progress: VariationProgress) => void;
}): Promise<ScoredVariation[]> {
  const { post, dna, brand, models = getAnalysisModels(), onProgress } = args;

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

  onProgress?.({ phase: "drafting" });

  const first = await withModelFallback(
    models,
    ({ model }) =>
      generateObject({
        model,
        schema: variationsSchema,
        system: VARIATIONS_SYSTEM,
        prompt: variationsPrompt({ post, dna, brand }),
      }),
    notify,
  );

  const scored: ScoredVariation[] = first.object.variations.map((v) => ({
    ...v,
    originality: checkOriginality(v.text, post.text),
    regenerated: false,
  }));

  onProgress?.({ phase: "checking" });

  const failing = scored.filter((v) => !v.originality.pass);
  if (failing.length === 0) return scored;

  // One retry, with the offending phrases named. Cheaper and more reliable
  // than looping — if the second pass still fails, the UI says so plainly
  // rather than silently shipping near-copy.
  const forbiddenPhrases = [
    ...new Set(failing.flatMap((v) => v.originality.sharedPhrases)),
  ].slice(0, 12);

  onProgress?.({
    phase: "rewriting",
    failing: failing.length,
    phrases: forbiddenPhrases.slice(0, 4),
  });

  try {
    const retry = await withModelFallback(
      models,
      ({ model }) =>
        generateObject({
          model,
          schema: variationsSchema,
          system: VARIATIONS_SYSTEM,
          prompt: variationsPrompt({ post, dna, brand, forbiddenPhrases }),
        }),
      notify,
    );

    const retried = new Map(
      retry.object.variations.map((v) => [
        v.angle,
        { ...v, originality: checkOriginality(v.text, post.text) },
      ]),
    );

    // Keep whichever attempt scored better, per angle — a retry that made
    // things worse should not be forced on the user.
    return scored.map((original) => {
      const candidate = retried.get(original.angle);
      if (!candidate) return original;
      if (candidate.originality.score <= original.originality.score) {
        return original;
      }
      return { ...candidate, regenerated: true };
    });
  } catch {
    return scored;
  }
}
