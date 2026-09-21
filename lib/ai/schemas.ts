import { z } from "zod";
import type { PlatformSpec } from "../platforms";

/* ------------------------------------------------------------------ *
 * Ad DNA — what the deconstruction pass extracts from the source post.
 * Shared by server and client so the streamed partial object is typed.
 * ------------------------------------------------------------------ */

export const hookTypes = [
  "negative-framing",
  "stat-callout",
  "pain-point",
  "contrarian",
  "curiosity-gap",
  "social-proof",
  "before-after",
  "listicle-promise",
  "authority",
  "question",
] as const;

export const beatRoles = [
  "hook",
  "agitation",
  "proof",
  "mechanism",
  "offer",
  "cta",
  "ps",
] as const;

export const adDnaSchema = z.object({
  hook: z.object({
    type: z.enum(hookTypes),
    verbatimOpening: z
      .string()
      .describe("The opening line exactly as written in the original."),
    whyItStops: z
      .string()
      .describe("One sentence: why this stops the scroll."),
  }),
  structure: z.object({
    beats: z
      .array(
        z.object({
          role: z.enum(beatRoles),
          purpose: z
            .string()
            .describe("What this beat does to the reader, in one clause."),
          lineCount: z.number().int().min(0),
        }),
      )
      .min(1)
      .max(10)
      .describe("The post's skeleton, in order."),
  }),
  formatting: z.object({
    emojiUse: z.string().describe("e.g. 'one directional emoji before the CTA'"),
    lineBreakPattern: z
      .string()
      .describe("e.g. 'single-line paragraphs, blank line between each'"),
    capsUse: z.string(),
    listStyle: z.string().describe("e.g. 'hyphen bullets' or 'none'"),
    approxLength: z.number().int().describe("Character count of the original."),
  }),
  audience: z.object({
    who: z.string(),
    painState: z.string().describe("Where their head is before they read it."),
    desiredOutcome: z.string(),
    sophisticationLevel: z.enum([
      "unaware",
      "problem-aware",
      "solution-aware",
      "product-aware",
      "most-aware",
    ]),
  }),
  persuasion: z.object({
    triggers: z
      .array(z.string())
      .min(1)
      .max(6)
      .describe("Psychological levers: urgency, loss aversion, status, etc."),
    objectionsHandled: z.array(z.string()).max(5),
    proofType: z.string().describe("e.g. 'specific number', 'named logo', 'none'"),
  }),
  cta: z.object({
    style: z.string(),
    verbatim: z.string(),
  }),
  visual: z
    .object({
      layout: z
        .string()
        .describe("Composition: split-screen, centred hero, chart, screenshot…"),
      palette: z
        .array(z.string())
        .min(1)
        .max(6)
        .describe("Dominant colours as plain names or hex."),
      subject: z.string().describe("What is literally depicted."),
      style: z.string().describe("Render style: photo, 3D, vector, screenshot…"),
      textOverlay: z.string().describe("Text burnt into the image, or 'none'."),
      emotionalRead: z.string().describe("What the image makes you feel."),
      roleInAd: z
        .string()
        .describe("What job the image does: proof, contrast, pattern-interrupt…"),
    })
    .nullable()
    .describe("Null when the post has no image."),
  whyItWorks: z
    .array(z.string())
    .min(3)
    .max(5)
    .describe("The transferable lessons, not a summary of the content."),
});

export type AdDna = z.infer<typeof adDnaSchema>;

/* ------------------------------------------------------------------ *
 * Variations
 * ------------------------------------------------------------------ */

export const angles = [
  "direct-swap",
  "aggressive",
  "minimalist",
  "curiosity-gap",
  "social-proof",
  "authority",
  "before-after",
  "story",
] as const;
export type Angle = (typeof angles)[number];

/** What a run uses unless the operator picks otherwise. */
export const DEFAULT_ANGLES: Angle[] = [
  "direct-swap",
  "aggressive",
  "minimalist",
];

export const ANGLE_LABELS: Record<Angle, { label: string; blurb: string }> = {
  "direct-swap": {
    label: "Direct swap",
    blurb: "Same layout, same emotional register. New words, new creative.",
  },
  aggressive: {
    label: "Aggressive",
    blurb: "More urgent, more problem-forward. Built for scaling spend.",
  },
  minimalist: {
    label: "Minimalist",
    blurb: "Emoji stripped, one-line hook, the visual carries the weight.",
  },
  "curiosity-gap": {
    label: "Curiosity gap",
    blurb: "Withholds the payoff. Names the result, hides the mechanism.",
  },
  "social-proof": {
    label: "Social proof",
    blurb: "Leads with who else already did this, not with the claim.",
  },
  authority: {
    label: "Authority",
    blurb: "Borrows credibility — data, credentials, a named source.",
  },
  "before-after": {
    label: "Before / after",
    blurb: "Two states side by side. The gap between them is the argument.",
  },
  story: {
    label: "Story",
    blurb: "One specific person, one specific moment. Narrative, not pitch.",
  },
};

export function parseAngles(input?: string[] | null): Angle[] {
  if (!input?.length) return DEFAULT_ANGLES;
  const valid = input.filter((a): a is Angle =>
    (angles as readonly string[]).includes(a),
  );
  // An unrecognised selection should not silently produce an empty run.
  return valid.length ? [...new Set(valid)] : DEFAULT_ANGLES;
}

export const variationSchema = z.object({
  angle: z.enum(angles),
  text: z
    .string()
    .describe("The complete post, ready to paste. Real line breaks."),
  /** Platform-shaped copy. Populated by buildVariationSchema; `text` stays as
   *  the flattened form so originality scoring and the library keep working. */
  fields: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  beatMapping: z
    .array(
      z.object({
        role: z.enum(beatRoles),
        line: z.string().describe("The line from your new post serving this beat."),
      }),
    )
    .min(1)
    .max(10)
    .describe("Proof the original skeleton survived the rewrite."),
  imagePrompt: z
    .string()
    .describe(
      "A complete text-to-image prompt. Inherit the original visual's JOB (visual.roleInAd) and its compositional relationship, and keep its FORMAT whenever the format is itself why it works — an organic-looking screenshot clones as a different screenshot, a meme as a different meme. Change the palette, subject, setting and any shown text. Never a generic desk, laptop or 'modern workspace' unless that was genuinely the mechanism.",
    ),
  visualMechanism: z
    .string()
    .describe(
      "One clause naming what the original visual did that this creative reproduces — the receipt that the insight survived. e.g. 'looks like a real forum post rather than an ad'.",
    ),
  imageNegatives: z
    .string()
    .describe("What the image must avoid. Comma separated."),
  altText: z.string(),
  rationale: z
    .string()
    .describe("One sentence on what this angle changes and why."),
});

export type Variation = z.infer<typeof variationSchema>;

export const variationsSchema = z.object({
  variations: z.array(variationSchema).length(3),
});

/* ------------------------------------------------------------------ *
 * Brand profile — optional. Empty means a generic rewrite.
 * ------------------------------------------------------------------ */

export const brandProfileSchema = z.object({
  productName: z.string().max(80).optional(),
  oneLiner: z.string().max(280).optional(),
  audience: z.string().max(280).optional(),
  offer: z.string().max(280).optional(),
  tone: z.string().max(140).optional(),
  bannedWords: z.string().max(280).optional(),
  brandColors: z.string().max(140).optional(),
  url: z.string().max(200).optional(),
});

export type BrandProfile = z.infer<typeof brandProfileSchema>;

export function hasBrand(b?: BrandProfile | null): boolean {
  if (!b) return false;
  return Boolean(b.productName?.trim() || b.oneLiner?.trim());
}

/* ------------------------------------------------------------------ *
 * The streamed envelope the UI consumes.
 * ------------------------------------------------------------------ */

export const cloneResultSchema = z.object({
  dna: adDnaSchema,
  variations: z.array(variationSchema).length(3),
});

export type CloneResult = z.infer<typeof cloneResultSchema>;

/* ------------------------------------------------------------------ *
 * Platform-shaped variations
 * ------------------------------------------------------------------ */

/**
 * Build a variation schema whose copy fields are the target platform's actual
 * fields, rather than one undifferentiated blob of text.
 *
 * The character limits go into each field's description so the model is told
 * the constraint — but they are still enforced afterwards by
 * lib/platforms/validate.ts, because models miscount characters and an ad two
 * characters over is rejected by the platform, not by us.
 */
export function buildVariationSchema(spec: PlatformSpec) {
  const copy: Record<string, z.ZodTypeAny> = {};

  for (const field of spec.fields) {
    const limit = field.recommended
      ? `Hard limit ${field.max} characters; aim under ${field.recommended}, where it truncates.`
      : `Hard limit ${field.max} characters.`;

    const describe = `${field.label}. ${limit} ${field.hint}`;

    copy[field.key] = field.repeat
      ? z
          .array(z.string().max(field.max))
          .min(field.repeat.min)
          .max(field.repeat.max)
          .describe(describe)
      : z.string().max(field.max).describe(describe);
  }

  return z.object({
    angle: z.enum(angles),
    copy: z.object(copy).describe(`Copy written for ${spec.label} ${spec.formatName}.`),
    beatMapping: z
      .array(
        z.object({
          role: z.enum(beatRoles),
          line: z.string().describe("The line from your new ad serving this beat."),
        }),
      )
      .min(1)
      .max(10)
      .describe("Proof the original skeleton survived the rewrite."),
    imagePrompt: variationSchema.shape.imagePrompt,
    visualMechanism: variationSchema.shape.visualMechanism,
    imageNegatives: variationSchema.shape.imageNegatives,
    altText: z.string(),
    rationale: variationSchema.shape.rationale,
  });
}

export function buildVariationsSchema(spec: PlatformSpec, count: number) {
  return z.object({
    variations: z.array(buildVariationSchema(spec)).length(count),
  });
}

export type PlatformVariation = z.infer<ReturnType<typeof buildVariationSchema>>;
