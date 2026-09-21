import type { SourcePost } from "../x/types";
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

IMAGE PROMPTS:
Write a prompt a text-to-image model can execute with no further context. It must keep the original's COMPOSITION and emotional read, while changing:
- the colour palette (state the new one explicitly)
- the literal subject matter
- the render style
Name the layout, the lighting, the mood and any text to render. If the original burnt a headline into the image, your prompt must specify new headline text, in quotes, short enough to render cleanly.

Write the three angles as specified. Same source DNA, genuinely different executions — not one post with three sets of synonyms.`;

export function variationsPrompt(args: {
  post: SourcePost;
  dna: AdDna;
  brand?: BrandProfile | null;
  /** Phrases a previous attempt lifted; must not reappear. */
  forbiddenPhrases?: string[];
}): string {
  const { post, dna, brand, forbiddenPhrases } = args;

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

  return [
    "--- ORIGINAL POST (for contrast — never copy from it) ---",
    post.text,
    "--- END ORIGINAL ---",
    "",
    "--- EXTRACTED DNA ---",
    JSON.stringify(dna, null, 2),
    "--- END DNA ---",
    brandBlock,
    forbiddenBlock,
    "",
    "PRODUCE THESE THREE ANGLES:",
    angleSpec,
  ].join("\n");
}
