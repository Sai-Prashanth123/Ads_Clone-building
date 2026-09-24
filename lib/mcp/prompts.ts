import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { DECONSTRUCT_SYSTEM, VARIATIONS_SYSTEM } from "../ai/prompts";
import { ANGLE_LABELS, angles, DEFAULT_ANGLES } from "../ai/schemas";
import {
  generationMax,
  getFormat,
  getPlatform,
  PLATFORM_IDS,
} from "../platforms";

/**
 * The craft instructions, as MCP prompts.
 *
 * These are the same strings the server-side pipeline used — they were written
 * for exactly this job and are the accumulated result of watching the output go
 * wrong in specific ways. Exposing them as prompts means the host gets them
 * without anyone retyping the reasoning into a chat window each time.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "deconstruct_ad",
    {
      title: "Deconstruct an ad's framework",
      description:
        "How to read a high-performing ad for its transferable machinery rather than its content. Use after fetch_ad.",
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              DECONSTRUCT_SYSTEM,
              "",
              "Produce the framework as structured data with these fields:",
              "• hook: { type, verbatimOpening, whyItStops }",
              "• structure.beats[]: { role, purpose, lineCount } in order",
              "• formatting: { emojiUse, lineBreakPattern, capsUse, listStyle, approxLength }",
              "• audience: { who, painState, desiredOutcome, sophisticationLevel }",
              "• persuasion: { triggers[], objectionsHandled[], proofType }",
              "• cta: { style, verbatim }",
              "• visual: { layout, palette[], subject, style, textOverlay, emotionalRead, roleInAd } — null if there is no creative",
              "• whyItWorks: 3–5 transferable lessons",
              "",
              "hook.type must be one of: negative-framing, stat-callout, pain-point, contrarian, curiosity-gap, social-proof, before-after, listicle-promise, authority, question.",
              "beat roles must be from: hook, agitation, proof, mechanism, offer, cta, ps.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "write_variations",
    {
      title: "Write platform-shaped variations",
      description:
        "The contract for rewriting an ad's framework without borrowing its words, in a specific platform's field structure.",
      argsSchema: {
        platform: z.enum(PLATFORM_IDS as [string, ...string[]]),
        format: z
          .string()
          .optional()
          .describe("Format id — thread, carousel, story, search. Defaults to the platform's single-image layout."),
        angles: z
          .string()
          .optional()
          .describe("Comma-separated angle names. Defaults to three."),
      },
    },
    ({ platform, format, angles: angleCsv }) => {
      const spec = getFormat(platform, format);

      const chosen = (angleCsv?.split(",").map((a) => a.trim()) ?? [])
        .filter((a) => (angles as readonly string[]).includes(a));
      const selected = chosen.length ? chosen : DEFAULT_ANGLES;

      const limitOf = (f: { max: number; recommended?: number }) =>
        f.recommended
          ? `write at most ${generationMax(f as Parameters<typeof generationMax>[0])}, truncates at ${f.recommended}, hard limit ${f.max}`
          : `hard limit ${f.max}`;

      const fieldLines = spec.fields.map((f) => {
        const repeat = f.repeat ? ` — supply ${f.repeat.min}–${f.repeat.max}` : "";
        return `• ${f.key} (${f.label}): ${limitOf(f)}${repeat}. ${f.hint}`;
      });

      // Carousel cards and thread posts are an ARRAY of records, and a model
      // told otherwise writes N headlines that each restate the whole ad.
      for (const group of spec.groups ?? []) {
        fieldLines.push(
          `• ${group.key}: an ARRAY of ${group.min}–${group.max} ${group.itemLabel.toLowerCase()} objects, in reading order. ${group.hint}`,
        );
        for (const f of group.fields) {
          fieldLines.push(`    – ${f.key} (${f.label}): ${limitOf(f)}. ${f.hint}`);
        }
      }

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                VARIATIONS_SYSTEM,
                "",
                "Before writing, call get_reference_ads with the source's hook type. It returns the saved ads that measurably performed in this niche, ranked by engagement rate. Three ads that actually worked calibrate register and specificity better than any further instruction — but never reuse their wording, which is checked against them too. An empty list is a real answer: write without examples.",
                "",
                `--- WRITING FOR ${getPlatform(platform).label.toUpperCase()} · ${spec.label} ---`,
                ...fieldLines,
                spec.ctaOptions
                  ? `The call to action must be exactly one of: ${spec.ctaOptions.join(", ")}.`
                  : "",
                "",
                "THE TRUNCATION POINT BEATS LENGTH FIDELITY. Matching the original's length is suspended wherever this platform truncates sooner — everything past the cut is invisible in the feed, so writing it only buries the hook. A 2,000-character source becoming a 150-character intro is correct.",
                "",
                `PRODUCE EXACTLY THESE ${selected.length} ANGLES, one variation each:`,
                ...selected.map(
                  (a) =>
                    `- ${a} — ${ANGLE_LABELS[a as keyof typeof ANGLE_LABELS].label}: ${ANGLE_LABELS[a as keyof typeof ANGLE_LABELS].blurb}`,
                ),
                "",
                "",
                `Then verify before showing anything. Call check_clone for every variation, passing platform "${platform}"${format ? `, format "${format}"` : ""} and the FIELDS you wrote — not a string you assembled yourself, because the arrangement you pick moves the fidelity score. One call returns all three verdicts.`,
                "",
                "Both axes have to pass. Originality proves the words are new; fidelity proves it is still the same ad. High originality alone means you may have written a good ad that is not a clone of this one — and that is the failure no amount of careful writing catches by eye.",
                "",
                "Then check_convergence across the set: three variations can each pass against the source and still be three paraphrases of one idea, which is the failure that wastes the batch.",
                "",
                "Revise whatever is flagged and check again. Do not present copy that has not passed. If a drift note says the target format is the constraint — a ten-card carousel cannot hold a 36-item list — that one is not yours to fix; say so and move on.",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "clone_ad",
    {
      title: "Clone an ad, end to end",
      description:
        "The full workflow: fetch, deconstruct, write, verify, render, save.",
      argsSchema: {
        source: z.string().describe("An X post URL, or pasted ad copy."),
        platform: z.enum(PLATFORM_IDS as [string, ...string[]]).optional(),
        format: z
          .string()
          .optional()
          .describe("Format id. Omit and step 3 will choose one."),
      },
    },
    ({ source, platform, format }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Clone this ad for ${platform ? getPlatform(platform).label : "X"}:`,
              "",
              source,
              "",
              "Work in this order:",
              "1. fetch_ad — read the copy and look at the creative if one comes back. If the URL is blocked it will ask for the copy; paste it and carry on.",
              "2. Use the deconstruct_ad prompt to extract the framework. Describe mechanics, not content.",
              `3. get_platform_spec("${platform ?? "x"}") and choose the FORMAT whose shape matches the source${format ? ` — ${format} was asked for` : ", saying why you picked it over the others"}. This decides more than the wording: a long-form listicle squeezed into one post loses the list, and the same source as a thread keeps it.`,
              "4. get_reference_ads with the source's hook type, as calibration.",
              "5. Use the write_variations prompt for that platform AND format.",
              "6. Verify with check_clone on each variation, passing the fields rather than a string you joined yourself. Then check_convergence across the set.",
              "7. Revise what it names and re-check. Repeat until clean, or until the only notes left are ones the format makes impossible — say which.",
              "8. list_image_models, then generate_images — one call carrying a prompt for EVERY variation, so the set comes back together. Inherit the original visual's JOB and keep its format when the format is the mechanism. Pick a model that honours dimensions if the frame shape matters, and one that can spell if the creative carries a word. Report the frame you actually got for each.",
              "9. save_swipe with the verified reports and the creatives attached.",
              "",
              "Show me each variation with its character counts and BOTH scores — originality and fidelity. They are opposite axes and a clone has to be high on both; a high originality score alone can mean you wrote a good ad that is not a clone of this one. Say plainly if anything could not be made to pass.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
