import { generateObject } from "ai";
import { getAnalysisModels, type NamedModel } from "./provider";
import {
  angles,
  buildVariationsSchema,
  type AdDna,
  type BrandProfile,
  type Variation,
} from "./schemas";
import { VARIATIONS_SYSTEM, variationsPrompt } from "./prompts";
import { checkOriginality, type OriginalityReport } from "../originality";
import { withModelFallback } from "./retry";
import type { SourcePost } from "../x/types";
import { PLATFORMS, fieldsToText, type PlatformSpec } from "../platforms";
import { validateAgainstSpec, type SpecReport } from "../platforms/validate";

export type ScoredVariation = Variation & {
  originality: OriginalityReport;
  /** Per-field character check against the target platform's published spec. */
  spec: SpecReport;
  /** True when this text is the product of an enforced rewrite. */
  regenerated: boolean;
};

type RawVariation = {
  angle: string;
  copy: Record<string, string | string[]>;
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
    spec: validateAgainstSpec(platform, raw.copy),
    regenerated: false,
  };
}

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
  /** Which platform's field structure and limits to write for. */
  platform?: PlatformSpec;
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
    models = getAnalysisModels(),
    onProgress,
  } = args;

  // The schema carries the platform's real fields and limits, so the model
  // writes LinkedIn copy rather than a blob someone later has to reshape.
  const schema = buildVariationsSchema(platform, angles.length);

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
        schema,
        system: VARIATIONS_SYSTEM,
        prompt: variationsPrompt({ post, dna, brand, platform }),
      }),
    notify,
  );

  const scored: ScoredVariation[] = first.object.variations.map((v) =>
    normalise(v as RawVariation, platform, post.text),
  );

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
          schema,
          system: VARIATIONS_SYSTEM,
          prompt: variationsPrompt({ post, dna, brand, platform, forbiddenPhrases }),
        }),
      notify,
    );

    const retried = new Map(
      retry.object.variations.map((v) => {
        const n = normalise(v as RawVariation, platform, post.text);
        return [n.angle, n] as const;
      }),
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
