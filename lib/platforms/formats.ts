import type { FormatSpec } from "./types";

/**
 * Formats beyond the single image.
 *
 * Each is a real ad product with its own published limits, not a variation on
 * one layout. A carousel is not a feed ad with extra text — it is N cards that
 * each have to work alone and in sequence, which is a different writing problem
 * and needs a different shape.
 */

/* ------------------------------------------------------------------ *
 * X — thread
 * ------------------------------------------------------------------ */

export const X_THREAD: FormatSpec = {
  id: "thread",
  label: "Thread",
  note: "Hook post plus numbered body posts. Clones long-form listicles far better than compressing one into a single post.",
  fields: [
    {
      key: "hookPost",
      label: "Hook post",
      max: 280,
      recommended: 240,
      multiline: true,
      hint: "Must stand alone and promise the thread. This is the only post most people see.",
    },
  ],
  groups: [
    {
      key: "posts",
      label: "Body posts",
      itemLabel: "Post",
      min: 2,
      max: 12,
      fields: [
        {
          key: "text",
          label: "Post",
          max: 280,
          recommended: 240,
          multiline: true,
          hint: "One idea per post. It should make sense if quoted on its own.",
        },
      ],
      hint: "Each post carries one beat of the argument.",
    },
  ],
  aspectRatios: ["16:9", "1:1"],
  defaultAspect: "16:9",
};

/* ------------------------------------------------------------------ *
 * Carousels — LinkedIn and Meta
 * ------------------------------------------------------------------ */

function carousel(args: {
  note: string;
  introMax: number;
  introRecommended: number;
  headlineMax: number;
  headlineRecommended: number;
  maxCards: number;
  aspectRatios: FormatSpec["aspectRatios"];
  defaultAspect: FormatSpec["defaultAspect"];
  ctaOptions?: string[];
}): FormatSpec {
  return {
    id: "carousel",
    label: "Carousel",
    note: args.note,
    fields: [
      {
        key: "introText",
        label: "Intro text",
        max: args.introMax,
        recommended: args.introRecommended,
        multiline: true,
        hint: "Sits above the cards. Sell the swipe, not the product.",
      },
    ],
    groups: [
      {
        key: "cards",
        label: "Cards",
        itemLabel: "Card",
        min: 2,
        max: args.maxCards,
        fields: [
          {
            key: "headline",
            label: "Card headline",
            max: args.headlineMax,
            recommended: args.headlineRecommended,
            hint: "One idea, readable at a glance while scrolling sideways.",
          },
          {
            key: "imagePrompt",
            label: "Card creative",
            max: 2000,
            multiline: true,
            notCopy: true,
            hint: "A prompt for this card's image. Cards must look like one set.",
          },
        ],
        hint: "Each card advances the argument. Card one earns the swipe; the last card carries the CTA.",
      },
    ],
    aspectRatios: args.aspectRatios,
    defaultAspect: args.defaultAspect,
    ctaOptions: args.ctaOptions,
    // The last card carries the CTA — see the group hint above.
    expectsTerminalCta: true,
  };
}

export const LINKEDIN_CAROUSEL = carousel({
  note: "2–10 cards. Strong for B2B teaching content — each card is one lesson.",
  introMax: 600,
  introRecommended: 150,
  headlineMax: 45,
  headlineRecommended: 30,
  maxCards: 10,
  aspectRatios: ["1:1", "1.91:1"],
  defaultAspect: "1:1",
  ctaOptions: [
    "Learn more",
    "Apply now",
    "Download",
    "Sign up",
    "Register",
    "Request demo",
  ],
});

export const META_CAROUSEL = carousel({
  note: "2–10 cards in feed. Each card can carry its own link.",
  introMax: 3000,
  introRecommended: 125,
  headlineMax: 255,
  headlineRecommended: 40,
  maxCards: 10,
  aspectRatios: ["1:1", "4:5"],
  defaultAspect: "1:1",
});

/* ------------------------------------------------------------------ *
 * Meta — story / reel
 * ------------------------------------------------------------------ */

export const META_STORY: FormatSpec = {
  id: "story",
  label: "Story / Reel",
  note: "Vertical full-screen. Minimal copy — the creative does the work and text overlays get cropped by the UI.",
  fields: [
    {
      key: "primaryText",
      label: "Primary text",
      max: 3000,
      recommended: 72,
      multiline: true,
      hint: "Very short. Stories bury anything long behind interface chrome.",
    },
    {
      key: "overlayText",
      label: "On-creative text",
      max: 60,
      recommended: 30,
      hint: "Burnt into the image. Keep clear of the top and bottom 14% — the UI covers it.",
    },
  ],
  aspectRatios: ["9:16"],
  defaultAspect: "9:16",
};

/* ------------------------------------------------------------------ *
 * Google — responsive search ad
 * ------------------------------------------------------------------ */

export const GOOGLE_RSA: FormatSpec = {
  id: "search",
  label: "Responsive search ad",
  note: "Pure text, no creative. Google mixes headlines and descriptions per query, so every asset must stand alone.",
  fields: [
    {
      key: "headlines",
      label: "Headlines",
      max: 30,
      repeat: { min: 3, max: 15 },
      hint: "Supply as many as you can. Vary the angle — benefit, feature, offer, objection — because Google picks which to show.",
    },
    {
      key: "descriptions",
      label: "Descriptions",
      max: 90,
      repeat: { min: 2, max: 4 },
      hint: "Expand one headline's promise. Assume it may be shown with any headline.",
    },
    {
      key: "displayPath",
      label: "Display path",
      max: 15,
      hint: "The readable slug after the domain. Optional but improves relevance.",
    },
  ],
  aspectRatios: ["1.91:1"],
  defaultAspect: "1.91:1",
};
