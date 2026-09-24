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

import {
  definePlatform,
  type AspectRatio as AspectRatioT,
  type FieldSpec as FieldSpecT,
  type FormatSpec as FormatSpecT,
  type PlatformId as PlatformIdT,
  type PlatformSpec as PlatformSpecT,
} from "./types";
import {
  GOOGLE_RSA,
  LINKEDIN_CAROUSEL,
  META_CAROUSEL,
  META_STORY,
  X_THREAD,
} from "./formats";

export type {
  PlatformId,
  AspectRatio,
  FieldSpec,
  GroupSpec,
  FormatSpec,
  PlatformSpec,
} from "./types";

const RAW = {
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
        fixedChoice: true,
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

/**
 * Each platform's default (single-image) layout becomes its first format, and
 * the extra formats follow. `definePlatform` mirrors the first onto the top
 * level, so every existing `spec.fields` call site keeps working.
 */
export const PLATFORMS: Record<PlatformIdT, PlatformSpecT> = {
  x: definePlatform({
    id: "x",
    label: RAW.x.label,
    note: RAW.x.note,
    formats: [
      {
        id: "post",
        label: RAW.x.formatName,
        note: "A single promoted post.",
        fields: RAW.x.fields as FieldSpecT[],
        aspectRatios: RAW.x.aspectRatios as AspectRatioT[],
        defaultAspect: RAW.x.defaultAspect as AspectRatioT,
      },
      X_THREAD,
    ],
  }),

  linkedin: definePlatform({
    id: "linkedin",
    label: RAW.linkedin.label,
    note: RAW.linkedin.note,
    formats: [
      {
        id: "single-image",
        label: RAW.linkedin.formatName,
        note: "One image, intro text, headline and a fixed CTA button.",
        fields: RAW.linkedin.fields as FieldSpecT[],
        aspectRatios: RAW.linkedin.aspectRatios as AspectRatioT[],
        defaultAspect: RAW.linkedin.defaultAspect as AspectRatioT,
        ctaOptions: RAW.linkedin.ctaOptions,
      },
      LINKEDIN_CAROUSEL,
    ],
  }),

  meta: definePlatform({
    id: "meta",
    label: RAW.meta.label,
    note: RAW.meta.note,
    formats: [
      {
        id: "feed",
        label: RAW.meta.formatName,
        note: "Standard feed placement.",
        fields: RAW.meta.fields as FieldSpecT[],
        aspectRatios: RAW.meta.aspectRatios as AspectRatioT[],
        defaultAspect: RAW.meta.defaultAspect as AspectRatioT,
      },
      META_CAROUSEL,
      META_STORY,
    ],
  }),

  google: definePlatform({
    id: "google",
    label: RAW.google.label,
    note: RAW.google.note,
    formats: [
      {
        id: "display",
        label: RAW.google.formatName,
        note: "Responsive display across the Google network.",
        fields: RAW.google.fields as FieldSpecT[],
        aspectRatios: RAW.google.aspectRatios as AspectRatioT[],
        defaultAspect: RAW.google.defaultAspect as AspectRatioT,
      },
      GOOGLE_RSA,
    ],
  }),
};

export const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformIdT[];

/** A specific format, falling back to the platform's default. */
export function getFormat(
  platform: string | undefined | null,
  formatId?: string | null,
): FormatSpecT {
  const spec = getPlatform(platform);
  if (!formatId) return spec.formats[0];
  return spec.formats.find((f) => f.id === formatId) ?? spec.formats[0];
}

/** Every format across every platform, for pickers and documentation. */
export function allFormats(): { platform: PlatformIdT; format: FormatSpecT }[] {
  return PLATFORM_IDS.flatMap((id) =>
    PLATFORMS[id].formats.map((format) => ({ platform: id, format })),
  );
}

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
export function generationMax(field: FieldSpecT): number {
  if (!field.recommended) return field.max;
  return Math.min(field.max, Math.round(field.recommended * 1.4));
}

export function getPlatform(id: string | undefined | null): PlatformSpecT {
  return PLATFORMS[(id as PlatformIdT) ?? "x"] ?? PLATFORMS.x;
}

/** The field whose text represents the ad in listings and originality checks. */
export function primaryFieldKey(spec: PlatformSpecT): string {
  return spec.fields[0].key;
}

/**
 * Flatten a format's field map into one string, for scoring and previews.
 *
 * Groups are flattened in reading order with their own fields joined, because
 * the originality and fidelity guards score the ad as a reader meets it. A
 * carousel whose cards were dropped here would score as a one-line ad and pass
 * every check while the cards themselves went unexamined.
 */
export function fieldsToText(
  spec: PlatformSpecT | FormatSpecT,
  fields: Record<string, unknown>,
): string {
  const flat = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(flat).filter(Boolean).join("\n");
    if (value && typeof value === "object") {
      return Object.values(value as Record<string, unknown>)
        .map(flat)
        .filter(Boolean)
        .join("\n");
    }
    return "";
  };

  const parts = spec.fields.map((f) => flat(fields[f.key]));

  for (const group of spec.groups ?? []) {
    const items = fields[group.key];
    if (!Array.isArray(items)) continue;

    items.forEach((item, index) => {
      const body = group.fields
        .map((f) => flat((item as Record<string, unknown>)?.[f.key]))
        .filter(Boolean)
        .join("\n");

      if (body) parts.push(`${group.itemLabel} ${index + 1}\n${body}`);
    });
  }

  return parts.filter(Boolean).join("\n\n").trim();
}

/** Pixel dimensions for an aspect, used by the image providers. */
export function aspectDimensions(aspect: AspectRatioT): {
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
    case "9:16":
      return { width: 576, height: 1024 };
    case "16:9":
    default:
      return { width: 1024, height: 576 };
  }
}
