import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { DECONSTRUCT_SYSTEM, VARIATIONS_SYSTEM } from "../ai/prompts";
import { ANGLE_LABELS, angles, DEFAULT_ANGLES } from "../ai/schemas";
import { generationMax, getPlatform, PLATFORM_IDS } from "../platforms";

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
        angles: z
          .string()
          .optional()
          .describe("Comma-separated angle names. Defaults to three."),
      },
    },
    ({ platform, angles: angleCsv }) => {
      const spec = getPlatform(platform);

      const chosen = (angleCsv?.split(",").map((a) => a.trim()) ?? [])
        .filter((a) => (angles as readonly string[]).includes(a));
      const selected = chosen.length ? chosen : DEFAULT_ANGLES;

      const fieldLines = spec.fields.map((f) => {
        const limit = f.recommended
          ? `write at most ${generationMax(f)}, truncates at ${f.recommended}, hard limit ${f.max}`
          : `hard limit ${f.max}`;
        const repeat = f.repeat ? ` — supply ${f.repeat.min}–${f.repeat.max}` : "";
        return `• ${f.key} (${f.label}): ${limit}${repeat}. ${f.hint}`;
      });

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                VARIATIONS_SYSTEM,
                "",
                `--- WRITING FOR ${spec.label.toUpperCase()} · ${spec.formatName} ---`,
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
                "Then verify before showing anything: call validate_ad for every variation, check_originality against the source, and check_convergence across the set. Revise whatever is flagged and check again. Do not present copy that has not passed.",
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
      },
    },
    ({ source, platform }) => ({
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
              "1. fetch_ad — read the copy and look at the creative if one comes back.",
              "2. Use the deconstruct_ad prompt to extract the framework. Describe mechanics, not content.",
              `3. get_platform_spec("${platform ?? "x"}") for the exact field names and limits.`,
              "4. Use the write_variations prompt to write the angles.",
              "5. Verify: validate_ad on each, check_originality against the source, check_convergence across the set.",
              "6. Revise anything flagged and re-check. Repeat until clean.",
              "7. generate_image for the creatives, inheriting the original visual's job and format.",
              "8. save_swipe with the verified reports attached.",
              "",
              "Show me the variations with their character counts and originality scores. Say plainly if anything could not be made to pass.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
