import type { SourcePost } from "../x/types";
import { generationMax, type PlatformSpec } from "../platforms";
import {
  ANGLE_LABELS,
  DEFAULT_ANGLES,
  type AdDna,
  type Angle,
  type BrandProfile,
  hasBrand,
} from "./schemas";
import { engagementRate } from "../x/types";
import { fingerprint } from "../fidelity";

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

Write exactly the angles you are asked for, one variation each. Same source DNA, genuinely different executions — not one post with several sets of synonyms. Two variations that differ only in wording are a failure: an automated check compares them against EACH OTHER as well as against the source.`;

export function variationsPrompt(args: {
  post: SourcePost;
  dna: AdDna;
  brand?: BrandProfile | null;
  /** The target platform's field structure and limits. */
  platform?: PlatformSpec;
  /** Which angles to write. */
  selectedAngles?: Angle[];
  /** Phrases a previous attempt lifted; must not reappear. */
  forbiddenPhrases?: string[];
  /** Structural drift a previous attempt introduced, measured not judged. */
  driftNotes?: string[];
}): string {
  const {
    post,
    dna,
    brand,
    platform,
    selectedAngles,
    forbiddenPhrases,
    driftNotes,
  } = args;

  // Only the angles this run asked for. Listing all eight when three were
  // requested invites the model to blend them.
  const chosen = selectedAngles?.length ? selectedAngles : DEFAULT_ANGLES;
  const angleSpec = chosen
    .map((id) => `- ${id} — ${ANGLE_LABELS[id].label}: ${ANGLE_LABELS[id].blurb}`)
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

  /* The structural targets, measured from the source rather than described.
   *
   * The contract already says "keep the skeleton", and models still drop the
   * bullet list and swap a link pointer for a hard CTA — because those are
   * formatting habits, not content, and nothing in the brief named them. The
   * fidelity guard measures exactly these dimensions afterwards, so naming them
   * up front is the difference between a guard that reports drift every run and
   * one that catches the runs that actually drifted. */
  const shape = fingerprint(post.text);

  /* How much room the body field actually has.
   *
   * "Keep the list" and "stay under 210 characters" are not both satisfiable
   * for a three-item list under a hook and a proof, and a field over its cap
   * fails the whole batch — every variation, not just the long one. So the
   * instruction carries the arithmetic instead of leaving the model to
   * discover the conflict: it is told how many items fit, and told to cut to
   * that number rather than overrun. */
  const body = platform?.fields.find((f) => !f.fixedChoice);
  const budget = body ? generationMax(body) : null;

  const itemCost = Math.max(12, Math.round(shape.bulletWords * 6) + 4);
  // Roughly half the field goes to the hook, the proof and the closer.
  const itemsThatFit =
    budget != null ? Math.max(0, Math.floor((budget * 0.5) / itemCost)) : shape.bulletCount;
  const keepItems = Math.min(shape.bulletCount, itemsThatFit);

  const listLine = !shape.bulletStyle
    ? "List: none. Do not add bullets the original did not have."
    : keepItems >= shape.bulletCount
      ? `List: ${shape.bulletCount} items with "${shape.bulletStyle}" bullets, about ${Math.round(shape.bulletWords)} words each. A scannable list IS the mechanism here — prose carrying the same points does not do the same job. Keep all ${shape.bulletCount}.`
      : keepItems >= 2
        ? `List: the original has ${shape.bulletCount} "${shape.bulletStyle}" bullet items. The target field only fits about ${keepItems}, so write exactly ${keepItems} — keep the scannable list, cut the weakest items. Do not convert them to prose, and do not exceed the field limit to fit more.`
        : `List: the original has ${shape.bulletCount} "${shape.bulletStyle}" bullet items, and the target field is too small for a list at all. Drop it. Spend the characters on the hook instead — a truncated list is worse than none.`;
  const shapeBlock = [
    "",
    "--- THE SHAPE TO MATCH (measured from the original) ---",
    `Opening move: ${shape.opening}. Your first line must be the same kind of move.`,
    `Closing move: ${shape.closing}. End the same way.`,
    listLine,
    `Sentence rhythm: ${shape.meanSentenceWords} words per sentence on average. Match it — punchy copy must stay punchy, and flowing copy must keep flowing.`,
    shape.digitDensity > 1
      ? `Numbers: the original is stat-led (${shape.digitDensity} digits per 100 words). Yours needs its own concrete figures, not vague equivalents.`
      : "Numbers: the original does not lean on figures. Do not invent statistics.",
    shape.emojiCount > 0
      ? `Emoji: ${shape.emojiCount}${shape.emojiLeads ? ", with one in the opening line" : ""}. Match the count and the placement.`
      : "Emoji: none. Do not add any.",
    "",
    "Opening move, closing move and emoji discipline cost no characters — match them even in the shortest field.",
    "",
    budget != null
      ? `THE FIELD LIMIT OUTRANKS EVERYTHING HERE. ${body?.label}: ${budget} characters, not one more — over it, the whole batch is rejected and nothing about its structure matters. Where a target above will not fit, satisfy it partially and stay inside the limit.`
      : "THE FIELD LIMIT OUTRANKS EVERYTHING HERE. A variation over its limit is rejected outright and nothing about its structure matters. Where a target will not fit, satisfy it partially and stay inside the limit.",
    "--- END SHAPE ---",
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

  const driftBlock = driftNotes?.length
    ? [
        "",
        "--- REJECTED: YOUR PREVIOUS DRAFT LOST THE ORIGINAL'S SHAPE ---",
        ...driftNotes.map((d) => `• ${d}`),
        "",
        "These are measurements, not opinions. Keep your new wording and fix the structure — a draft that reads well but is shaped differently is a different ad, not a clone of this one.",
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
        "Count characters carefully. A field over its hard limit is rejected by the platform and the whole variation is wasted.",
        "",
        "THE TRUNCATION POINT BEATS LENGTH FIDELITY. The contract asks you to match the original's length — that rule is suspended wherever this platform truncates sooner. A 2,000-character source becoming a 150-character intro is correct, not a failure: everything past the cut is invisible in the feed, so writing it changes nothing except pushing the hook out of view. Fit the field, and if the source's structure will not compress, keep its FIRST beat and drop the rest rather than spilling past the cut.",
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
    shapeBlock,
    platformBlock,
    brandBlock,
    forbiddenBlock,
    driftBlock,
    "",
    `PRODUCE EXACTLY THESE ${chosen.length} ANGLES, one variation each:`,
    angleSpec,
  ].join("\n");
}
