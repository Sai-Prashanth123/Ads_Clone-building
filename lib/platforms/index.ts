/**
 * What each ad platform actually accepts.
 *
 * One registry, used three ways: it shapes the zod schema the model fills, it
 * drives the character counters in the UI, and it is what `validate.ts` checks
 * against. Keeping those three in sync by hand is how a headline ends up two
 * characters over the limit and nobody notices until the platform rejects it.
 *
 * Limits are the published 2026 specs. `max` is the hard ceiling — past it the
 * platform refuses the ad. `recommended` is where the platform truncates in
 * the feed, which is a softer but more important number: copy past it still
 * runs, it just stops being read.
 */

export type PlatformId = "x" | "linkedin" | "meta" | "google";

export type AspectRatio = "16:9" | "1:1" | "4:5" | "1.91:1";

export type FieldSpec = {
  key: string;
  label: string;
  /** Hard limit. Over this is a failure. */
  max: number;
  /** Truncation point. Over this is a warning. */
  recommended?: number;
  multiline?: boolean;
  /** Fields the platform wants several of, e.g. Google's short headlines. */
  repeat?: { min: number; max: number };
  hint: string;
};

export type PlatformSpec = {
  id: PlatformId;
  label: string;
  /** What the format is called in the ad manager. */
  formatName: string;
  fields: FieldSpec[];
  aspectRatios: AspectRatio[];
  defaultAspect: AspectRatio;
  ctaOptions?: string[];
  /** Shown in the picker so the choice is informed. */
  note: string;
};

export const PLATFORMS: Record<PlatformId, PlatformSpec> = {
  x: {
    id: "x",
    label: "X",
    formatName: "Promoted post",
    fields: [
      {
        key: "text",
        label: "Post text",
        max: 25_000,
        recommended: 280,
        multiline: true,
        hint: "Past 280 the post becomes long-form and collapses behind 'Show more'.",
      },
    ],
    aspectRatios: ["16:9", "1:1", "4:5"],
    defaultAspect: "16:9",
    note: "One free-form body. The only platform here with no hard headline field.",
  },

  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    formatName: "Single image ad",
    fields: [
      {
        key: "introText",
        label: "Intro text",
        max: 600,
        recommended: 150,
        multiline: true,
        hint: "Truncates at ~150 characters in feed. The first line does all the work.",
      },
      {
        key: "headline",
        label: "Headline",
        max: 200,
        recommended: 70,
        hint: "Sits under the image. Past 70 it wraps and loses impact.",
      },
      {
        key: "cta",
        label: "Call to action",
        max: 20,
        hint: "Must be one of LinkedIn's fixed button labels.",
      },
    ],
    aspectRatios: ["1.91:1", "1:1"],
    defaultAspect: "1.91:1",
    ctaOptions: [
      "Learn more",
      "Apply now",
      "Download",
      "Get quote",
      "Sign up",
      "Subscribe",
      "Register",
      "Request demo",
    ],
    note: "B2B. Intro text truncates hard at 150 — front-load the hook.",
  },

  meta: {
    id: "meta",
    label: "Meta",
    formatName: "Feed ad (Facebook / Instagram)",
    fields: [
      {
        key: "primaryText",
        label: "Primary text",
        max: 3000,
        recommended: 125,
        multiline: true,
        hint: "Collapses behind 'See more' at ~125 characters.",
      },
      {
        key: "headline",
        label: "Headline",
        max: 255,
        recommended: 40,
        hint: "Bold line under the creative. 40 is where it starts truncating.",
      },
      {
        key: "description",
        label: "Description",
        max: 255,
        recommended: 30,
        hint: "Often hidden entirely depending on placement. Keep it disposable.",
      },
    ],
    aspectRatios: ["1:1", "4:5", "16:9"],
    defaultAspect: "4:5",
    note: "4:5 takes the most mobile feed real estate.",
  },

  google: {
    id: "google",
    label: "Google Display",
    formatName: "Responsive display ad",
    fields: [
      {
        key: "shortHeadlines",
        label: "Short headlines",
        max: 30,
        repeat: { min: 3, max: 5 },
        hint: "Google mixes these per placement. Each must stand alone.",
      },
      {
        key: "longHeadline",
        label: "Long headline",
        max: 90,
        hint: "Used where there is room for one line instead of a short headline.",
      },
      {
        key: "description",
        label: "Description",
        max: 90,
        multiline: true,
        hint: "Supports the headline. Assume it may not be shown.",
      },
      {
        key: "businessName",
        label: "Business name",
        max: 25,
        hint: "Shown alongside the logo.",
      },
    ],
    aspectRatios: ["1.91:1", "1:1"],
    defaultAspect: "1.91:1",
    note: "Assets are recombined per slot, so every piece must work on its own.",
  },
};

export const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformId[];

/**
 * The ceiling to give the MODEL, which is not the platform's hard limit.
 *
 * A zod `.max()` is a structural constraint a model respects; a `recommended`
 * value in prose is a suggestion it weighs against everything else it was
 * told. Measured across a real run: every field whose max/recommended ratio
 * was under ~10x landed in range, while Meta's primary text at 24x (3000 vs
 * 125) came back at 891–2065 characters. The prose was losing to the schema.
 *
 * So generation is capped near the truncation point, with enough slack for a
 * sentence that runs slightly over. Validation still reports against the
 * platform's real numbers — the schema steers, the report tells the truth.
 */
export function generationMax(field: FieldSpec): number {
  if (!field.recommended) return field.max;
  return Math.min(field.max, Math.round(field.recommended * 1.4));
}

export function getPlatform(id: string | undefined | null): PlatformSpec {
  return PLATFORMS[(id as PlatformId) ?? "x"] ?? PLATFORMS.x;
}

/** The field whose text represents the ad in listings and originality checks. */
export function primaryFieldKey(spec: PlatformSpec): string {
  return spec.fields[0].key;
}

/** Flatten a platform's field map into one string, for scoring and previews. */
export function fieldsToText(
  spec: PlatformSpec,
  fields: Record<string, string | string[]>,
): string {
  return spec.fields
    .map(({ key }) => {
      const value = fields[key];
      if (Array.isArray(value)) return value.join("\n");
      return value ?? "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

/** Pixel dimensions for an aspect, used by the image providers. */
export function aspectDimensions(aspect: AspectRatio): {
  width: number;
  height: number;
} {
  switch (aspect) {
    case "1:1":
      return { width: 1024, height: 1024 };
    case "4:5":
      return { width: 832, height: 1024 };
    case "1.91:1":
      return { width: 1200, height: 628 };
    case "16:9":
    default:
      return { width: 1024, height: 576 };
  }
}
