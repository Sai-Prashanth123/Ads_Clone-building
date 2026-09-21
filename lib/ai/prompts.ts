import type { SourcePost } from "../x/types";
import type { PlatformSpec } from "../platforms";
import { ANGLE_LABELS, type AdDna, type BrandProfile, hasBrand } from "./schemas";
import { engagementRate } from "../x/types";

export const DECONSTRUCT_SYSTEM = `You are a direct-response strategist who reverse-engineers high-performing social ads for a living.

You are shown a post that measurably performed. Your job is to extract the TRANSFERABLE MACHINERY — the parts that would still work if the product, industry and audience all changed.

Rules:
- Describe mechanics, never summarise content. "Opens with a specific dollar figure to buy credibility before the claim" is useful. "Talks about SaaS pricing" is not.
- Quote the original exactly where a field asks for verbatim text.
- Judge the structure that is actually on the page, not the structure you wish were there. If there is no proof beat, do not invent one.
- If an image is provided, read it as an ad creative: what the composition does, not just what it shows. Name the real dominant colours.
- whyItWorks must contain lessons a different advertiser could apply tomorrow.`;

export function deconstructPrompt(post: SourcePost): string {
  const e = post.engagement;
  const rate = engagementRate(e);

  const stats = [
    e.likes != null && `${e.likes.toLocaleString()} likes`,
    e.retweets != null && `${e.retweets.toLocaleString()} reposts`,
    e.bookmarks != null && `${e.bookmarks.toLocaleString()} bookmarks`,
    e.replies != null && `${e.replies.toLocaleString()} replies`,
    e.views != null && `${e.views.toLocaleString()} views`,
    rate != null && `${(rate * 100).toFixed(2)}% engagement rate`,
  ]
    .filter(Boolean)
    .join(" · ");

  return [
    `POST BY @${post.author.handle} (${post.author.name})`,
    stats && `MEASURED PERFORMANCE: ${stats}`,
    post.isLongForm && "FORMAT: long-form post.",
    post.truncated &&
      "NOTE: this body may be truncated by the source. Analyse only what is present.",
    "",
    "--- POST TEXT ---",
    post.text,
    "--- END POST TEXT ---",
    "",
    post.media.length
      ? `The post's creative is attached as an image. Analyse it and fill the "visual" field.`
      : `This post has no image. Set "visual" to null.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ */

export const VARIATIONS_SYSTEM = `You are a direct-response copywriter producing ad variants that borrow a proven FRAMEWORK without borrowing a single phrase.

You will be given the deconstructed DNA of an ad that performed, and the original text.

THE CONTRACT — all three must hold at once:
1. KEEP the skeleton: same beat order, same hook TYPE, same emotional register, same formatting habits (line-break rhythm, bullet style, emoji discipline, roughly comparable length).
2. CHANGE every surface: different words, different metaphors, different examples, different numbers, different rhythm within each line.
3. NEVER reuse a distinctive phrase from the original. Three consecutive content words shared is already too many. Assume an automated plagiarism check will run on your output and reject it — because one will.

If a phrase in your draft could be found by searching the original, rewrite that line.

IMAGE PROMPTS — the creative must inherit the original's MECHANISM, not just its mood.

The DNA tells you the visual's job (the "roleInAd" field) and why it earned attention. That job is the thing being cloned. Work in this order:

1. KEEP, always:
   - the job the image does (proof, pattern-interrupt, contrast, punchline, credibility)
   - the compositional relationship that delivers it (e.g. one-vs-many, before/after, close-up over wide)
   - the emotional read

2. KEEP the FORMAT when the format is itself the reason it works.
   This is the trap: if the image performs because it looks like an organic screenshot, a native forum or chat post, a real dashboard, a candid photo or a familiar meme, then that format IS the mechanism. Cloning it as a polished illustration or a stock-style scene throws away the entire insight. A screenshot clones as a DIFFERENT screenshot. A meme clones as a DIFFERENT meme.
   Only change the render style when the style is incidental — decoration rather than mechanism.

3. CHANGE everything identifying:
   - the colour palette (state the new one explicitly)
   - the literal subject matter, product, people and setting
   - the specific numbers, names and wording shown

Then write the prompt so a text-to-image model can execute it with no further context: name the layout, what occupies each region, the lighting, the mood, and any text to render.

TEXT INSIDE THE IMAGE — image models garble long passages into nonsense letterforms. Specify at most ONE short line of legible text, under about eight words, in quotes. Everything else should be described as visual texture ("further lines of smaller body text, not legible"), so the render reads as an authentic screenshot without attempting paragraphs it cannot spell. Never ask for a full sentence of body copy.

Never describe a generic desk, laptop, dashboard, notebook or "modern workspace" unless the original's mechanism genuinely was that. Those read as stock photography and kill the ad.

Write the three angles as specified. Same source DNA, genuinely different executions — not one post with three sets of synonyms.`;

export function variationsPrompt(args: {
  post: SourcePost;
  dna: AdDna;
  brand?: BrandProfile | null;
  /** The target platform's field structure and limits. */
  platform?: PlatformSpec;
  /** Phrases a previous attempt lifted; must not reappear. */
  forbiddenPhrases?: string[];
}): string {
  const { post, dna, brand, platform, forbiddenPhrases } = args;

  const angleSpec = Object.entries(ANGLE_LABELS)
    .map(([id, v]) => `- ${id} — ${v.label}: ${v.blurb}`)
    .join("\n");

  const brandBlock = hasBrand(brand)
    ? [
        "",
        "--- SELL THIS PRODUCT ---",
        brand?.productName && `Product: ${brand.productName}`,
        brand?.oneLiner && `What it does: ${brand.oneLiner}`,
        brand?.audience && `Audience: ${brand.audience}`,
        brand?.offer && `Offer / CTA target: ${brand.offer}`,
        brand?.tone && `Tone to hold: ${brand.tone}`,
        brand?.brandColors &&
          `Brand colours (use these in the image prompts): ${brand.brandColors}`,
        brand?.url && `Link: ${brand.url}`,
        brand?.bannedWords && `NEVER use these words: ${brand.bannedWords}`,
        "",
        "Every variation must sell THIS product using the framework above. Do not sell the original advertiser's product.",
        "--- END PRODUCT ---",
      ]
        .filter(Boolean)
        .join("\n")
    : [
        "",
        "No product was supplied. Keep each variation about the same concept as the original, but written from scratch — treat it as a rewrite brief, not a retarget.",
      ].join("\n");

  const forbiddenBlock = forbiddenPhrases?.length
    ? [
        "",
        "--- REJECTED: YOUR PREVIOUS DRAFT LIFTED THESE ---",
        ...forbiddenPhrases.map((p) => `• "${p}"`),
        "",
        "These exact sequences, and anything within one or two words of them, must not appear. Rewrite those lines from a different angle entirely.",
        "--- END REJECTED ---",
      ].join("\n")
    : "";

  // Naming the destination changes the writing: a LinkedIn intro that truncates
  // at 150 characters is a different craft problem from a 280-character post.
  const platformBlock = platform
    ? [
        "",
        `--- WRITING FOR ${platform.label.toUpperCase()} · ${platform.formatName} ---`,
        ...platform.fields.map((f) => {
          const limit = f.recommended
            ? `max ${f.max}, truncates at ${f.recommended}`
            : `max ${f.max}`;
          const count = f.repeat
            ? ` — supply ${f.repeat.min}–${f.repeat.max} of these`
            : "";
          return `• ${f.label} (${limit})${count}: ${f.hint}`;
        }),
        platform.ctaOptions
          ? `The call to action must be exactly one of: ${platform.ctaOptions.join(", ")}.`
          : "",
        "",
        "Count characters carefully. A field over its hard limit is rejected by the platform and the whole variation is wasted. Where a field truncates, put the decisive words before the cut.",
        "--- END FORMAT ---",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return [
    "--- ORIGINAL POST (for contrast — never copy from it) ---",
    post.text,
    "--- END ORIGINAL ---",
    "",
    "--- EXTRACTED DNA ---",
    JSON.stringify(dna, null, 2),
    "--- END DNA ---",
    platformBlock,
    brandBlock,
    forbiddenBlock,
    "",
    "PRODUCE THESE THREE ANGLES:",
    angleSpec,
  ].join("\n");
}
